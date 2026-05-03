import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { Terminal, Smartphone, Play, Save, Trash2, Plug, AlertCircle } from 'lucide-react';

// WebADB 라이브러리 (최신 daemon-webusb 패키지 사용)
import { Adb } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { Consumable, InspectStream } from '@yume-chan/stream-extra';

const firebaseConfig = {
  apiKey: "AIzaSyCeLR6Mfh1ClXA2YzLYaleF8BolJG31CIA",
  authDomain: "automatics-16a4b.firebaseapp.com",
  projectId: "automatics-16a4b",
  storageBucket: "automatics-16a4b.firebasestorage.app",
  messagingSenderId: "996939521715",
  appId: "1:996939521715:web:df123800de21a2ef589ac6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const appId = typeof __app_id !== 'undefined' ? __app_id : 'aptner-automator';

export default function App() {
  const [user, setUser] = useState(null);
  const [adbClient, setAdbClient] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptContent, setScriptContent] = useState(
    '# 아파트너 앱 실행\nmonkey -p com.aptner.app 1\nsleep 2\n\n# 스마트 명령어\nclick("로그인")\ntype("my_id_123")'
  );
  const [logs, setLogs] = useState(["[시스템] 스마트 자동화 도구 준비 완료..."]);
  const [isRunning, setIsRunning] = useState(false);
  const logsEndRef = useRef(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        addLog(`[인증 오류] ${error.message}`);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const scriptsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'scripts');
    const unsubscribe = onSnapshot(scriptsRef, (snapshot) => {
      const loadedScripts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setScripts(loadedScripts);
    }, (err) => {
      addLog(`[DB 오류] 데이터를 불러올 수 없습니다: ${err.message}`);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const connectDevice = async () => {
    try {
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) {
        addLog("[오류] 현재 브라우저가 WebUSB를 지원하지 않습니다.");
        return;
      }
      const device = await manager.requestDevice();
      if (!device) return;

      addLog(`[시스템] ${device.name} 연결 시도 중...`);
      const connection = await device.connect();
      const adb = await Adb.create(connection);
      setAdbClient(adb);
      addLog(`[연결 성공] ${device.name} 연결 완료!`);
    } catch (error) {
      addLog(`[연결 실패] ${error.message}`);
    }
  };

  const disconnectDevice = async () => {
    if (adbClient) {
      await adbClient.close();
      setAdbClient(null);
      addLog("[시스템] 연결이 해제되었습니다.");
    }
  };

  const findTextBounds = async (text) => {
    if (!adbClient) return null;
    addLog(`> 화면에서 '${text}' 검색 중...`);
    try {
      const dumpProcess = await adbClient.subprocess.spawn('uiautomator dump /sdcard/view.xml');
      await dumpProcess.stdout.pipeTo(new WritableStream());
      await dumpProcess.exit;

      const catProcess = await adbClient.subprocess.spawn('cat /sdcard/view.xml');
      let xml = '';
      await catProcess.stdout.pipeTo(new WritableStream({
        write(chunk) { xml += new TextDecoder().decode(chunk); }
      }));
      await catProcess.exit;

      const regex = new RegExp(`(?:text|content-desc)="[^"]*?${text}[^"]*?".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
      const match = xml.match(regex);

      if (match) {
        const x = Math.floor((parseInt(match[1]) + parseInt(match[3])) / 2);
        const y = Math.floor((parseInt(match[2]) + parseInt(match[4])) / 2);
        addLog(`[발견] '${text}' 좌표: (${x}, ${y})`);
        return { x, y };
      }
      addLog(`[실패] '${text}'를 찾을 수 없습니다.`);
      return null;
    } catch (e) {
      addLog(`[에러] 스캔 실패: ${e.message}`);
      return null;
    }
  };

  const executeScript = async () => {
    if (!adbClient) return;
    setIsRunning(true);
    addLog("=================================");
    
    const lines = scriptContent.split('\n');
    try {
      for (const line of lines) {
        const cmd = line.trim();
        if (!cmd || cmd.startsWith('#')) continue;

        if (cmd.startsWith('sleep ')) {
          const s = parseFloat(cmd.split(' ')[1]);
          addLog(`> ${s}초 대기...`);
          await new Promise(r => setTimeout(r, s * 1000));
        } else if (cmd.startsWith('click("')) {
          const target = cmd.match(/click\("([^"]+)"\)/)[1];
          const pos = await findTextBounds(target);
          if (pos) {
            await (await adbClient.subprocess.spawn(`input tap ${pos.x} ${pos.y}`)).exit;
          }
        } else if (cmd.startsWith('type("')) {
          const txt = cmd.match(/type\("([^"]+)"\)/)[1].replace(/ /g, '%s');
          await (await adbClient.subprocess.spawn(`input text '${txt}'`)).exit;
        } else {
          addLog(`> shell: ${cmd}`);
          await (await adbClient.subprocess.spawn(cmd)).exit;
        }
      }
      addLog("✅ 모든 작업 완료.");
    } catch (e) {
      addLog(`[중단] ${e.message}`);
    } finally {
      setIsRunning(false);
      addLog("=================================");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Smartphone className="text-indigo-600" /> 아파트너 스마트 컨트롤러
          </h1>
          <button onClick={adbClient ? disconnectDevice : connectDevice} className={`px-5 py-2 rounded-xl font-semibold ${adbClient ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-indigo-600 text-white'}`}>
            <Plug className="w-4 h-4 inline mr-2" /> {adbClient ? '해제' : '연결'}
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="font-bold mb-4">스크립트 목록</h3>
            <div className="space-y-2">
              {scripts.map(s => (
                <div key={s.id} className="p-3 bg-slate-50 rounded-xl flex justify-between items-center">
                  <button onClick={() => {setScriptTitle(s.title); setScriptContent(s.content);}} className="truncate flex-1 text-left">{s.title}</button>
                  <button onClick={() => deleteScript(s.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </aside>

          <main className="lg:col-span-2 space-y-6">
            <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <input type="text" value={scriptTitle} onChange={e => setScriptTitle(e.target.value)} placeholder="제목" className="w-full text-lg font-bold border-b outline-none pb-1" />
              <textarea value={scriptContent} onChange={e => setScriptContent(e.target.value)} className="w-full h-64 p-4 bg-slate-900 text-slate-300 font-mono text-sm rounded-xl outline-none" spellCheck="false" />
              <button onClick={executeScript} disabled={isRunning || !adbClient} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold">
                {isRunning ? '실행 중...' : '스크립트 실행'}
              </button>
            </section>

            <section className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center gap-2 mb-3"><Terminal className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400 text-xs font-bold uppercase">Log</span></div>
              <div className="h-40 overflow-y-auto font-mono text-xs text-slate-400 space-y-1 custom-scrollbar">
                {logs.map((log, i) => <div key={i}>{log}</div>)}
                <div ref={logsEndRef} />
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
