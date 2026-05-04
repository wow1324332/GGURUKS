import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { Terminal, Smartphone, Play, Save, Trash2, Plug, Info, Sparkles, Loader2, RefreshCw, List } from 'lucide-react';

// WebADB 라이브러리 (정적 임포트로 빌드 에러 방지)
import { Adb } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';

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

const appId = "aptner-automator";

export default function App() {
  const [user, setUser] = useState(null);
  const [adbClient, setAdbClient] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptContent, setScriptContent] = useState('# 명령어를 입력하거나 AI를 사용하세요.');
  const [logs, setLogs] = useState(["[시스템] 도구 준비 완료..."]);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const logsEndRef = useRef(null);

  // Vercel 환경 변수 안전하게 가져오기
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    // import.meta를 try-catch로 감싸서 환경에 상관없이 빌드가 터지지 않도록 보호
    try {
        if (import.meta && import.meta.env) {
            setApiKey(import.meta.env.VITE_GEMINI_API_KEY || "");
        }
    } catch (e) {
        // 로컬 환경 등의 fallback
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        let token = null;
        try { token = window.__initial_auth_token; } catch (e) {}
        
        if (token) {
          await signInWithCustomToken(auth, token);
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

  const generateAiScript = async () => {
    if (!aiPrompt.trim()) return;
    if (!apiKey) return addLog("[AI 오류] API 키가 설정되지 않았습니다.");

    setIsGenerating(true);
    addLog(`[AI] 명령 해석 중...`);

    const systemPrompt = `당신은 안드로이드 ADB 전문가입니다. 사용자의 한글 요청을 ADB 스크립트로 변환하세요.
규칙: 1. 주석은 #으로 시작 2. 앱 실행: monkey -p com.aptner.app 1 3. 대기: sleep [초] 4. 스마트 명령어: click("글자"), type("텍스트") 활용 5. 결과값은 오직 코드만 출력하세요. 마크다운 기호를 절대 포함하지 마세요.`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      });
      const result = await response.json();
      let text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        // 파서 충돌을 막기 위해 문자열 코드로 백틱 필터링 우회
        const bt3 = String.fromCharCode(96, 96, 96);
        const lines = text.split('\n');
        const cleanedLines = lines.filter(line => line.indexOf(bt3) === -1);
        const cleanedText = cleanedLines.join('\n').trim();
        
        setScriptContent(cleanedText);
        addLog("[AI] 스크립트 생성이 완료되었습니다.");
        setAiPrompt("");
      }
    } catch (error) {
      addLog(`[AI 오류] ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // 가장 안정적이었던 이전 연결 로직 복구
  const connectDevice = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      if (adbClient) {
        try { await adbClient.close(); } catch(e) {}
        setAdbClient(null);
      }
      
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) {
          throw new Error("WebUSB를 지원하지 않는 브라우저입니다.");
      }

      const device = await manager.requestDevice();
      if (!device) {
          setIsConnecting(false);
          return;
      }

      addLog(`[시스템] ${device.name} 연결 시도...`);
      const connection = await device.connect();
      
      addLog(`[시스템] ADB 핸드쉐이크 초기화...`);
      let adb;
      try {
        // 정석적인 Fallback 초기화 (이전에 성공했던 방식)
        adb = new Adb(connection);
      } catch (e) {
        throw new Error("ADB 인스턴스 생성 실패");
      }
      
      addLog(`[시스템] 기기 인증 및 기능 확인 중...`);
      let isReady = false;
      
      // 최대 5초 대기하며 subprocess 준비 확인
      for (let i = 0; i < 10; i++) {
        if (adb.subprocess) {
           isReady = true;
           break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!isReady) {
         throw new Error("기기 인증 시간이 초과되었거나 연결이 불안정합니다. 기기에서 'USB 디버깅 허용'을 확인해주세요.");
      }

      // 🌟 핵심 방어 로직: features 배열을 최상위와 subprocess 양쪽에 모두 강제 주입
      if (!adb.features) adb.features = ['shell_v2', 'cmd'];
      if (adb.subprocess && !adb.subprocess.features) {
         adb.subprocess.features = ['shell_v2', 'cmd'];
      }

      setAdbClient(adb);
      addLog(`[시스템] 연결 성공! 이제 스크립트를 실행할 수 있습니다.`);
      
    } catch (error) {
        addLog(`[연결 실패] ${error.message}`);
        if (error.message.includes('claimInterface')) {
            addLog(`> 다른 브라우저 탭이나 프로그램을 모두 닫고 시도하세요.`);
        }
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectDevice = async () => {
    if (adbClient) {
      try { await adbClient.close(); } catch (e) {}
      setAdbClient(null);
      addLog("[시스템] 연결이 해제되었습니다.");
    }
  };

  const listPackages = async () => {
    if (!adbClient || !adbClient.subprocess) return addLog("[오류] 기기를 연결하세요.");
    
    // 다시 한 번 안전장치 가동
    if (!adbClient.features) adbClient.features = ['shell_v2', 'cmd'];
    if (!adbClient.subprocess.features) adbClient.subprocess.features = ['shell_v2', 'cmd'];
    
    addLog("[시스템] 설치된 패키지 목록 추출 중...");
    try {
      const process = await adbClient.subprocess.spawn('pm list packages -3');
      let output = '';
      
      // 스트림 읽기 에러를 방지하는 가장 안전한 방식
      await process.stdout.pipeTo(new WritableStream({
        write(chunk) { output += new TextDecoder().decode(chunk); }
      }));
      await process.exit;

      const packages = output.split('\n').filter(line => line.includes('aptner')).map(line => line.replace('package:', '').trim());

      if (packages.length > 0) {
        addLog(`[발견] 아파트너 관련 패키지: ${packages.join(', ')}`);
        addLog(`> 이 이름을 스크립트의 monkey -p 뒤에 넣으세요.`);
      } else {
        addLog("[안내] 'aptner'가 포함된 패키지를 찾지 못했습니다. 전체 목록을 보려면 'pm list packages -3'을 실행하세요.");
        console.log(output);
      }
    } catch (e) {
      addLog(`[에러] 목록 추출 실패: ${e.message}`);
      addLog(`> 기기를 분리했다가 다시 연결해보세요.`);
    }
  };

  const findTextBounds = async (text) => {
    if (!adbClient || !adbClient.subprocess) return null;
    
    if (!adbClient.features) adbClient.features = ['shell_v2', 'cmd'];
    if (!adbClient.subprocess.features) adbClient.subprocess.features = ['shell_v2', 'cmd'];

    try {
      const dump = await adbClient.subprocess.spawn('uiautomator dump /sdcard/view.xml');
      await dump.stdout.pipeTo(new WritableStream());
      await dump.exit;
      
      const cat = await adbClient.subprocess.spawn('cat /sdcard/view.xml');
      let xml = '';
      await cat.stdout.pipeTo(new WritableStream({ write(c) { xml += new TextDecoder().decode(c); } }));
      await cat.exit;
      
      const reg = new RegExp(`(?:text|content-desc)="[^"]*?${text}[^"]*?".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
      const m = xml.match(reg);
      if (m) {
        const x = Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2);
        const y = Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2);
        addLog(`[발견] '${text}' (${x}, ${y})`);
        return { x, y };
      }
      return null;
    } catch (e) { return null; }
  };

  const executeScript = async () => {
    if (!adbClient || !adbClient.subprocess) return addLog("[오류] 기기를 연결하세요.");
    
    if (!adbClient.features) adbClient.features = ['shell_v2', 'cmd'];
    if (!adbClient.subprocess.features) adbClient.subprocess.features = ['shell_v2', 'cmd'];
    
    setIsRunning(true);
    addLog("=================================");
    
    const bt3 = String.fromCharCode(96, 96, 96);
    const scriptLines = scriptContent.split('\n');
    const sanitizedLines = scriptLines.filter(line => line.indexOf(bt3) === -1);
    const lines = sanitizedLines.join('\n').split('\n');
    
    try {
      for (const line of lines) {
        const cmd = line.trim();
        if (!cmd || cmd.startsWith('#')) continue;
        if (cmd.startsWith('sleep ')) {
          await new Promise(r => setTimeout(r, parseFloat(cmd.split(' ')[1]) * 1000));
        } else if (cmd.startsWith('click("')) {
          const target = cmd.match(/click\("([^"]+)"\)/)?.[1];
          if (target) {
            const pos = await findTextBounds(target);
            if (pos) {
                const proc = await adbClient.subprocess.spawn(`input tap ${pos.x} ${pos.y}`);
                await proc.exit;
            }
          }
        } else if (cmd.startsWith('type("')) {
          const txt = cmd.match(/type\("([^"]+)"\)/)?.[1]?.replace(/ /g, '%s');
          if (txt) {
              const proc = await adbClient.subprocess.spawn(`input text '${txt}'`);
              await proc.exit;
          }
        } else {
          addLog(`> 명령 전송: ${cmd}`);
          const proc = await adbClient.subprocess.spawn(cmd);
          await proc.exit;
        }
      }
      addLog("✅ 스크립트 실행 완료.");
    } catch (e) { addLog(`[중단] ${e.message}`); } finally { setIsRunning(false); addLog("================================="); }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center text-slate-900">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Smartphone className="text-indigo-600" /> 아파트너 AI 자동화
          </h1>
          <div className="flex items-center gap-2">
            {adbClient && (
              <button onClick={listPackages} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors flex items-center gap-2">
                <List className="w-4 h-4" /> 패키지 목록
              </button>
            )}
            <button 
              onClick={adbClient ? disconnectDevice : connectDevice} 
              disabled={isConnecting}
              className={`px-5 py-2 rounded-xl font-semibold transition-all flex items-center gap-2 ${adbClient ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-indigo-600 text-white shadow-lg disabled:opacity-50'}`}
            >
              {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {adbClient ? '해제' : isConnecting ? '초기화 중...' : '연결'}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-slate-900">
          <aside className="space-y-6">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-5 rounded-2xl text-white shadow-lg">
              <h3 className="font-bold mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4" /> AI 스마트 변환</h3>
              <p className="text-xs text-indigo-100 mb-4 leading-relaxed">원하는 동작을 한글로 입력하세요.</p>
              <div className="space-y-3">
                <input type="text" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="예: 로그인 버튼 클릭해줘" className="w-full p-3 bg-white/10 border border-white/20 rounded-xl text-sm placeholder:text-white/40 focus:outline-none text-white shadow-inner" onKeyDown={(e) => e.key === 'Enter' && generateAiScript()} />
                <button onClick={generateAiScript} disabled={isGenerating || !aiPrompt.trim()} className="w-full py-2.5 bg-white text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 shadow-md">
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : "스크립트로 변환"}
                </button>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
              <h3 className="font-bold mb-4 flex items-center gap-2 text-slate-700"><Save className="w-4 h-4" /> 저장된 목록</h3>
              <div className="space-y-2">
                {scripts.length === 0 ? <p className="text-slate-400 text-xs py-4 text-center">목록이 비어있습니다.</p> : scripts.map(s => (
                  <div key={s.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group">
                    <button onClick={() => {setScriptTitle(s.title); setScriptContent(s.content);}} className="truncate flex-1 text-left font-medium hover:text-indigo-600 text-sm">{s.title}</button>
                    <button onClick={async () => { if (!user) return; await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'scripts', s.id)); addLog("[시스템] 삭제됨."); }} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="lg:col-span-2 space-y-6">
            <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center text-slate-900">
                <input type="text" value={scriptTitle} onChange={e => setScriptTitle(e.target.value)} placeholder="제목" className="flex-1 text-lg font-bold border-b border-slate-100 outline-none pb-1 focus:border-indigo-500" />
                <button onClick={async () => { if (!user || !scriptTitle) return; const scriptsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'scripts'); await addDoc(scriptsRef, { title: scriptTitle, content: scriptContent, createdAt: new Date().toISOString() }); addLog(`[시스템] 저장됨.`); }} className="text-slate-400 hover:text-indigo-600 p-2"><Save className="w-5 h-5" /></button>
              </div>
              <textarea value={scriptContent} onChange={e => setScriptContent(e.target.value)} className="w-full h-64 p-4 bg-slate-900 text-slate-300 font-mono text-xs md:text-sm rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" spellCheck="false" />
              <button onClick={executeScript} disabled={isRunning || !adbClient} className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${isRunning || !adbClient ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100'}`}>
                {isRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isRunning ? '스크립트 실행 중...' : '스크립트 실행'}
              </button>
            </section>

            <section className="bg-[#1e1e1e] p-5 rounded-2xl border border-slate-800 shadow-inner">
              <div className="flex items-center gap-2 mb-3"><Terminal className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Terminal Output</span></div>
              <div className="h-40 overflow-y-auto font-mono text-[10px] md:text-xs text-slate-400 space-y-1 custom-scrollbar">
                {logs.map((log, i) => <div key={i} className={log?.includes('✅') || log?.includes('성공') ? 'text-emerald-400' : log?.includes('오류') || log?.includes('실패') || log?.includes('중단') ? 'text-red-400' : ''}>{log}</div>)}
                <div ref={logsEndRef} />
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
