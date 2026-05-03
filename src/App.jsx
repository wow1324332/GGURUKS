// 깃허브 App.jsx 파일에 복사/붙여넣기 하실 코드
// (Canvas 화면은 무시하시고 이 코드만 사용하세요)

import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc } from "firebase/firestore";
import { Terminal, Smartphone, Play, Save, Trash2, Plug, AlertCircle } from 'lucide-react';

// Vercel 배포용 WebADB 라이브러리 (package.json에 "@yume-chan/adb-backend-webusb": "latest" 필수)
import { Adb } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-backend-webusb';
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
  
  // 스마트 스크립트 예시로 변경
  const [scriptContent, setScriptContent] = useState(
    '# 아파트너 앱 실행\nmonkey -p com.aptner.app 1\nsleep 2\n\n# 글자를 스캔하여 터치하는 스마트 명령어\nclick("아이디")\ntype("my_id_123")\n\nclick("비밀번호")\ntype("password123!")\n\nclick("로그인")'
  );
  
  const [logs, setLogs] = useState(["[시스템] 아파트너 스마트 자동화 도구 준비 완료..."]);
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
      const Manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!Manager) {
        addLog("[오류] 현재 브라우저가 WebUSB를 지원하지 않습니다. Chrome을 사용해주세요.");
        return;
      }
      const device = await Manager.requestDevice();
      if (!device) {
        addLog("[취소] 기기 선택이 취소되었습니다.");
        return;
      }
      addLog(`[시스템] ${device.name} 연결 시도 중... 폰 화면에서 'USB 디버깅 허용'을 눌러주세요.`);
      
      const connection = await device.connect();
      const adb = await Adb.create(connection);
      setAdbClient(adb);
      addLog(`[연결 성공] 기기가 성공적으로 연결되었습니다!`);
    } catch (error) {
      addLog(`[연결 실패] ${error.message}`);
    }
  };

  const disconnectDevice = async () => {
    if (adbClient) {
      try {
        await adbClient.close();
      } catch (e) {
        console.error(e);
      }
      setAdbClient(null);
      addLog("[시스템] 기기 연결이 해제되었습니다.");
    }
  };

  const saveScript = async () => {
    if (!user) return;
    if (!scriptTitle.trim() || !scriptContent.trim()) {
      addLog("[안내] 제목과 내용을 모두 입력해주세요.");
      return;
    }
    try {
      const scriptsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'scripts');
      await addDoc(scriptsRef, { title: scriptTitle, content: scriptContent, createdAt: new Date().toISOString() });
      setScriptTitle('');
      addLog(`[저장 완료] '${scriptTitle}' 스크립트가 저장되었습니다.`);
    } catch (error) {
      addLog(`[저장 실패] ${error.message}`);
    }
  };

  const deleteScript = async (id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'scripts', id));
      addLog("[시스템] 스크립트가 삭제되었습니다.");
    } catch (error) {
      addLog(`[삭제 실패] ${error.message}`);
    }
  };

  // --- 스마트 터치(UI 덤프) 로직 추가 ---
  const findTextBounds = async (text) => {
    if (!adbClient) return null;
    
    addLog(`> 화면에서 '${text}' 검색 중...`);
    try {
      // 1. 화면 덤프 생성 (SD 카드 임시 경로에 저장)
      const dumpCmd = 'uiautomator dump /sdcard/window_dump.xml';
      const dumpProcess = await adbClient.subprocess.spawn(dumpCmd);
      await dumpProcess.stdout.pipeTo(new WritableStream());
      await dumpProcess.exit;

      // 2. 덤프 파일 읽어오기
      const catCmd = 'cat /sdcard/window_dump.xml';
      const catProcess = await adbClient.subprocess.spawn(catCmd);
      
      let xmlContent = '';
      await catProcess.stdout.pipeTo(new WritableStream({
        write(chunk) {
          const decoder = new TextDecoder();
          xmlContent += decoder.decode(chunk);
        }
      }));
      await catProcess.exit;

      // 3. 정규식으로 해당 텍스트를 가진 노드의 bounds(좌표) 추출
      // 예: <node text="로그인" bounds="[100,200][300,400]" ... />
      // 속성값이 text, content-desc 인 경우를 모두 검색합니다.
      const regex = new RegExp(`(?:text|content-desc)="[^"]*?${text}[^"]*?".*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
      const match = xmlContent.match(regex);

      if (match) {
        const x1 = parseInt(match[1]);
        const y1 = parseInt(match[2]);
        const x2 = parseInt(match[3]);
        const y2 = parseInt(match[4]);
        
        // 버튼의 중앙 좌표 계산
        const centerX = Math.floor((x1 + x2) / 2);
        const centerY = Math.floor((y1 + y2) / 2);
        
        addLog(`[검색 완료] '${text}' 좌표 발견: (${centerX}, ${centerY})`);
        return { x: centerX, y: centerY };
      } else {
        addLog(`[오류] 화면에서 '${text}'를 찾을 수 없습니다.`);
        return null;
      }
    } catch (e) {
      addLog(`[오류] UI 덤프 실패: ${e.message}`);
      return null;
    }
  };
  // ------------------------------------

  const executeScript = async () => {
    if (!adbClient) {
      addLog("[오류] 먼저 스마트폰을 연결해주세요.");
      return;
    }
    
    setIsRunning(true);
    addLog("=================================");
    addLog(`▶ '${scriptTitle || '새 스크립트'}' 실행 시작...`);
    
    const lines = scriptContent.split('\n');
    
    try {
      for (const line of lines) {
        const cmd = line.trim();
        if (!cmd || cmd.startsWith('#')) continue; 
        
        if (cmd.startsWith('sleep ')) {
          const seconds = parseFloat(cmd.split(' ')[1]);
          addLog(`> 대기 중: ${seconds}초...`);
          await new Promise(r => setTimeout(r, seconds * 1000));
        
        // 스마트 클릭 명령어 처리 (예: click("로그인"))
        } else if (cmd.startsWith('click(')) {
          const textMatch = cmd.match(/click\("([^"]+)"\)/);
          if (textMatch) {
            const targetText = textMatch[1];
            const coords = await findTextBounds(targetText);
            
            if (coords) {
              const tapCmd = `input tap ${coords.x} ${coords.y}`;
              addLog(`> 터치 실행: ${tapCmd}`);
              const tapProcess = await adbClient.subprocess.spawn(tapCmd);
              await tapProcess.stdout.pipeTo(new WritableStream());
              await tapProcess.exit;
              await new Promise(r => setTimeout(r, 500)); // 터치 후 잠시 대기
            }
          }
        
        // 스마트 텍스트 입력 처리 (예: type("my_id"))
        } else if (cmd.startsWith('type(')) {
          const textMatch = cmd.match(/type\("([^"]+)"\)/);
          if (textMatch) {
            const inputText = textMatch[1];
            // 공백을 %s로 변환하는 등 adb input text에 맞는 포맷팅
            const safeText = inputText.replace(/ /g, '%s');
            const typeCmd = `input text '${safeText}'`;
            addLog(`> 텍스트 입력: ${inputText}`);
            const typeProcess = await adbClient.subprocess.spawn(typeCmd);
            await typeProcess.stdout.pipeTo(new WritableStream());
            await typeProcess.exit;
            await new Promise(r => setTimeout(r, 500));
          }

        // 일반 ADB 쉘 명령어 처리
        } else {
          addLog(`> adb shell ${cmd}`);
          const process = await adbClient.subprocess.spawn(cmd);
          await process.stdout.pipeTo(new WritableStream());
          await process.exit;
        }
      }
      addLog("✅ 스크립트 실행 완료.");
    } catch (error) {
      addLog(`[실행 오류] ${error.message}`);
    } finally {
      setIsRunning(false);
      addLog("=================================");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-7 h-7 text-indigo-600" />
              아파트너 스마트 자동화 툴
            </h1>
            <p className="text-sm text-slate-500 mt-1">UI 텍스트 스캔 및 WebUSB 기반 실기기 제어</p>
          </div>
          <div className="flex items-center gap-3">
            {adbClient ? (
              <button onClick={disconnectDevice} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors font-medium">
                <Plug className="w-4 h-4" /> 연결됨 (해제하기)
              </button>
            ) : (
              <button onClick={connectDevice} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-sm shadow-indigo-200">
                <Plug className="w-4 h-4" /> USB 기기 연결
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Save className="w-5 h-5 text-slate-500" /> 클라우드 스크립트
            </h2>
            {scripts.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-100 rounded-xl">
                저장된 스크립트가 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {scripts.map(script => (
                  <div key={script.id} className="p-3 border border-slate-200 rounded-xl hover:border-indigo-300 transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-slate-800">{script.title}</span>
                      <button onClick={() => deleteScript(script.id)} className="text-slate-400 hover:text-red-500 p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <button 
                      onClick={() => {
                        setScriptTitle(script.title);
                        setScriptContent(script.content);
                      }}
                      className="text-sm text-indigo-600 font-medium hover:text-indigo-800"
                    >
                      불러오기 →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <input 
                  type="text" value={scriptTitle} onChange={(e) => setScriptTitle(e.target.value)}
                  placeholder="스크립트 제목 (예: 자동 로그인)"
                  className="text-lg font-semibold border-b border-slate-200 pb-1 px-1 focus:outline-none focus:border-indigo-500 w-1/2"
                />
                <button onClick={saveScript} className="flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors">
                  <Save className="w-4 h-4" /> DB에 저장
                </button>
              </div>
              <textarea
                value={scriptContent} onChange={(e) => setScriptContent(e.target.value)}
                className="w-full h-64 p-4 bg-slate-900 text-slate-300 font-mono text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                spellCheck="false"
              />
              <div className="flex justify-end">
                <button 
                  onClick={executeScript} disabled={isRunning}
                  className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-xl font-medium shadow-sm ${isRunning ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200 transition-colors'}`}
                >
                  <Play className="w-4 h-4" />
                  {isRunning ? '실행 중...' : '스마트폰에서 실행하기'}
                </button>
              </div>
            </div>

            <div className="bg-[#1e1e1e] p-4 rounded-2xl shadow-sm border border-slate-800">
              <div className="flex items-center gap-2 mb-3 px-2">
                <Terminal className="w-4 h-4 text-emerald-500" />
                <span className="text-emerald-500 font-mono text-sm font-semibold">실행 로그</span>
              </div>
              <div className="h-48 overflow-y-auto font-mono text-xs md:text-sm text-slate-300 space-y-1 px-2 custom-scrollbar">
                {logs.map((log, index) => (
                  <div key={index} className={`${log.includes('[오류]') || log.includes('실패') ? 'text-red-400' : ''} ${log.includes('✅') || log.includes('성공') ? 'text-emerald-400' : ''}`}>
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
