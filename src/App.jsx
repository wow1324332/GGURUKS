import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { Terminal, Smartphone, Play, Save, Trash2, Plug, Info, Sparkles, Loader2 } from 'lucide-react';

// WebADB 라이브러리
import { Adb } from '@yume-chan/adb';
import * as AdbWebUsb from '@yume-chan/adb-daemon-webusb';

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

// AI API Key: 실행 환경에서 자동 주입됩니다. 직접 입력하지 마세요.
const apiKey = "";

export default function App() {
  const [user, setUser] = useState(null);
  const [adbClient, setAdbClient] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptContent, setScriptContent] = useState('# 명령어를 직접 쓰거나 위 AI 기능을 사용해보세요.');
  const [logs, setLogs] = useState(["[시스템] 스마트 자동화 도구 준비 완료..."]);
  const [isRunning, setIsRunning] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
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
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // ==========================================
  // AI 명령어 변환 모듈 (규격 준수)
  // ==========================================
  const generateAiScript = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    addLog(`[AI] 명령 해석 시작: "${aiPrompt}"`);

    const systemPrompt = `당신은 안드로이드 ADB 스크립트 전문가입니다. 사용자의 한글 요청을 받아서 실행 가능한 ADB 쉘 스크립트로 변환하세요.
규칙:
1. 주석은 #으로 시작합니다.
2. 앱 실행은 monkey -p [패키지명] 1 명령어를 사용하세요. 아파트너 패키지명은 com.aptner.app 입니다.
3. 대기는 sleep [초] 형식을 사용하세요.
4. 스마트 명령어 click("[글자]")와 type("[텍스트]")를 적극적으로 활용하세요.
5. 결과값은 오직 코드만 출력하세요. 설명은 필요 없습니다.`;

    // 지수 백오프를 포함한 호출 로직
    const callGeminiWithRetry = async (prompt, retries = 5) => {
      const delays = [1000, 2000, 4000, 8000, 16000];
      
      for (let i = 0; i <= retries; i++) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              systemInstruction: { parts: [{ text: systemPrompt }] }
            })
          });

          if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
          
          const result = await response.json();
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Empty response from AI');
          return text;

        } catch (error) {
          if (i === retries) throw error;
          await new Promise(r => setTimeout(r, delays[i]));
        }
      }
    };

    try {
      const generatedCode = await callGeminiWithRetry(aiPrompt);
      setScriptContent(generatedCode.trim());
      addLog("[AI] 스크립트가 성공적으로 생성되었습니다.");
      setAiPrompt("");
    } catch (error) {
      addLog(`[AI 오류] 명령어 생성에 실패했습니다. (네트워크 상태를 확인하세요)`);
    } finally {
      setIsGenerating(false);
    }
  };

  const connectDevice = async () => {
    try {
      const manager = AdbWebUsb.AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) {
        addLog("[오류] 현재 브라우저가 WebUSB를 지원하지 않습니다.");
        return;
      }
      const device = await manager.requestDevice();
      if (!device) return;

      addLog(`[시스템] ${device.name || '기기'} 연결 시도 중...`);
      const connection = await device.connect();
      const adb = new Adb(connection);
      setAdbClient(adb);
      addLog(`[연결 성공] ${device.name || '기기'} 연결 완료!`);
    } catch (error) {
      addLog(`[연결 실패] ${error?.message || '연결 중 오류 발생'}`);
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
    if (!adbClient || !adbClient.subprocess) return null;
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
    if (!adbClient) return addLog("[오류] 기기를 먼저 연결하세요.");
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
            <Smartphone className="text-indigo-600" /> 아파트너 AI 자동화
          </h1>
          <button onClick={adbClient ? disconnectDevice : connectDevice} className={`px-5 py-2 rounded-xl font-semibold ${adbClient ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-indigo-600 text-white'}`}>
            <Plug className="w-4 h-4 inline mr-2" /> {adbClient ? '해제' : '연결'}
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="space-y-6">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-5 rounded-2xl text-white shadow-lg">
              <h3 className="font-bold mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> AI 스마트 변환
              </h3>
              <p className="text-xs text-indigo-100 mb-4 leading-relaxed">
                "아파트너 앱 열고 로그인 버튼 눌러줘" 처럼 자연스럽게 말해보세요.
              </p>
              <div className="space-y-3">
                <input 
                  type="text" 
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="예: 앱 열고 3초 뒤에 확인 클릭"
                  className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/50"
                  onKeyDown={(e) => e.key === 'Enter' && generateAiScript()}
                />
                <button 
                  onClick={generateAiScript}
                  disabled={isGenerating || !aiPrompt.trim()}
                  className="w-full py-2.5 bg-white text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2 shadow-md shadow-indigo-900/20"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : "스크립트로 변환"}
                </button>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
              <h3 className="font-bold mb-4 text-slate-700 flex items-center gap-2"><Save className="w-4 h-4" /> 스크립트 목록</h3>
              <div className="space-y-2">
                {scripts.map(s => (
                  <div key={s.id} className="p-3 bg-slate-50 rounded-xl flex justify-between items-center group">
                    <button onClick={() => {setScriptTitle(s.title); setScriptContent(s.content);}} className="truncate flex-1 text-left font-medium hover:text-indigo-600 transition-colors">{s.title}</button>
                    <button onClick={async () => {
                      if (!user) return;
                      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'scripts', s.id));
                      addLog("[시스템] 삭제 완료");
                    }} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="lg:col-span-2 space-y-6">
            <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <input type="text" value={scriptTitle} onChange={e => setScriptTitle(e.target.value)} placeholder="제목을 입력하세요" className="flex-1 text-lg font-bold border-b outline-none pb-1 focus:border-indigo-500" />
                <button onClick={async () => {
                   if (!user) return;
                   const scriptsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'scripts');
                   await addDoc(scriptsRef, { title: scriptTitle || '제목 없음', content: scriptContent, createdAt: new Date().toISOString() });
                   addLog(`[성공] '${scriptTitle || '제목 없음'}' 저장됨`);
                }} className="text-slate-400 hover:text-indigo-600 p-2"><Save className="w-5 h-5" /></button>
              </div>
              <textarea value={scriptContent} onChange={e => setScriptContent(e.target.value)} className="w-full h-64 p-4 bg-slate-900 text-slate-300 font-mono text-sm rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" spellCheck="false" />
              <button onClick={executeScript} disabled={isRunning || !adbClient} className={`w-full py-3 rounded-xl font-bold transition-all ${isRunning || !adbClient ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100'}`}>
                {isRunning ? '실행 중...' : '스크립트 실행'}
              </button>
            </section>

            <section className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center gap-2 mb-3"><Terminal className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Log</span></div>
              <div className="h-40 overflow-y-auto font-mono text-xs text-slate-400 space-y-1 custom-scrollbar">
                {logs.map((log, i) => <div key={i} className={log?.includes('✅') || log?.includes('[연결 성공]') ? 'text-emerald-400' : log?.includes('[에러]') || log?.includes('[AI]') ? 'text-indigo-300' : ''}>{log}</div>)}
                <div ref={logsEndRef} />
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
