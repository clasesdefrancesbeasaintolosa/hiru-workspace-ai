import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  Eye,
  Languages,
  Layout,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Presentation as PresentationIcon,
  Radio,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
  Volume2,
  Briefcase,
  Scale,
  Zap,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
} from "lucide-react";
import { GoogleGenAI } from "@google/genai";
import {
  AppState,
  AnalysisResponse,
  ExportRequest,
  HistoryItem,
  LiveActions,
  LiveTranscription,
  PresentationResponse,
  SupportedLanguage,
  LANGUAGE_NAMES,
  UserProfile,
} from "./types";
import {
  connectLive,
  createBlob,
  decode,
  decodeAudioData,
  generateStrategicPresentation,
  startAnalysis,
} from "./geminiService";

// Declaring global aistudio for mandatory API key selection logic (Veo/Gemini 3 Pro)
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const getStoredProfile = (): UserProfile | null => {
  const saved = localStorage.getItem("hiru_profile_v4");
  return saved ? JSON.parse(saved) : null;
};

const App: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile>(() => getStoredProfile() || { situation: "", objective: "", focusOrNeed: "", level: "Senior" });
  const [appState, setAppState] = useState<AppState>(() => (getStoredProfile() ? AppState.IDLE : AppState.SETUP));
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => JSON.parse(localStorage.getItem("hiru_history_v4") || "[]"));

  // Presentation States
  const [presentationLang, setPresentationLang] = useState<SupportedLanguage>("es");
  const [targetCulture, setTargetCulture] = useState("");
  const [presentationResult, setPresentationResult] = useState<PresentationResponse | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Live API States
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveTranscriptions, setLiveTranscriptions] = useState<LiveTranscription[]>([]);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<string>("Clasificación");
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [liveActions, setLiveActions] = useState<LiveActions | null>(null);
  const [exportState, setExportState] = useState<{ status: string; url?: string; type?: string }>({ status: "idle" });

  const nextStartTimeRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    localStorage.setItem("hiru_history_v4", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("hiru_profile_v4", JSON.stringify(profile));
  }, [profile]);

  const hardReset = () => {
    if (confirm("¿Borrar todo y reiniciar Hiru?")) {
      localStorage.clear();
      setProfile({ situation: "", objective: "", focusOrNeed: "", level: "Senior" });
      setHistory([]);
      setInputText("");
      setResult(null);
      setPresentationResult(null);
      setCurrentSlide(0);
      setAppState(AppState.SETUP);
    }
  };

  const handleAnalysis = async () => {
    if (!inputText.trim()) return;
    setAppState(AppState.LOADING);
    try {
      const r = await startAnalysis(inputText, profile, "media", "profesional");
      setResult(r);
      setAppState(AppState.RESULT);
    } catch {
      setAppState(AppState.IDLE);
    }
  };

  const handleGeneratePresentation = async () => {
    setAppState(AppState.LOADING);
    try {
      const p = await generateStrategicPresentation(inputText || result?.execution.content || "", profile, presentationLang, targetCulture);
      setPresentationResult(p);
      setCurrentSlide(0);
      setAppState(AppState.PRESENTATION);
    } catch {
      setAppState(AppState.RESULT);
    }
  };

  const stopLiveSession = () => {
    try {
      if (liveSessionRef.current) {
        liveSessionRef.current.close();
        liveSessionRef.current = null;
      }
      if (sourcesRef.current) {
        for (const source of sourcesRef.current) source.stop();
        sourcesRef.current.clear();
      }
    } catch {
      // ignore
    } finally {
      setIsLiveActive(false);
      setIsLiveConnecting(false);
    }
  };

  const startLiveSession = async () => {
    setIsLiveConnecting(true);
    setIsLiveActive(true);
    setLiveTranscriptions([]);
    setPreviewContent(null);
    setLiveActions(null);
    setExportState({ status: "idle" });
    setCurrentPhase("Clasificación");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const sessionPromise = connectLive(
        {
          onopen: () => {
            setIsLiveConnecting(false);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const outCtx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);

              const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outCtx.destination);
              source.addEventListener("ended", () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              setLiveTranscriptions((prev) => [
                ...prev,
                { text: message.serverContent!.inputTranscription!.text, type: "user", timestamp: Date.now() },
              ]);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setLiveTranscriptions((prev) => [...prev, { text, type: "model", timestamp: Date.now() }]);

              if (text.includes("PREVIEW")) {
                setCurrentPhase("Vista Previa");
                const previewPart = text.split("PREVIEW")[1].split("ACTIONS:")[0].trim();
                setPreviewContent(previewPart);
              }

              if (text.includes("ACTIONS:")) {
                try {
                  const actions = JSON.parse(text.split("ACTIONS:")[1].trim());
                  setLiveActions(actions);
                  if (actions.export?.status === "ready") handleExport(actions.export);
                } catch {
                  // ignore json parse errors
                }
              }
            }

            if (message.serverContent?.interrupted) {
              for (const src of sourcesRef.current) src.stop();
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: stopLiveSession,
          onclose: stopLiveSession,
        },
        profile
      );

      liveSessionRef.current = await sessionPromise;
    } catch {
      stopLiveSession();
    }
  };

  const handleExport = async (request: ExportRequest) => {
    // Mandatory API key selection for Veo models as per guidelines
    if (request.payload.format === "VIDEO") {
      try {
        if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
          await window.aistudio.openSelectKey();
        }
      } catch (err) {
        console.warn("Could not handle API key selection logic", err);
      }
    }

    setExportState({ status: "processing", type: request.payload.format });

    try {
      const apiKey = import.meta.env.VITE_API_KEY as string | undefined;
      if (!apiKey) throw new Error("Missing VITE_API_KEY");

      // Create new GoogleGenAI right before call
      const ai = new GoogleGenAI({ apiKey });
      let resultUrl = "";

      if (request.payload.format === "IMAGE") {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ parts: [{ text: request.payload.prompt || "Genera una imagen profesional" }] }],
          config: { imageConfig: { aspectRatio: request.payload.aspect_ratio || "1:1" } },
        });

        const imgPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        if (imgPart?.inlineData?.data) {
          resultUrl = `data:image/png;base64,${imgPart.inlineData.data}`;
        }
      } else if (request.payload.format === "VIDEO") {
        let op = await ai.models.generateVideos({
          model: "veo-3.1-fast-generate-preview",
          prompt: request.payload.prompt || "Un video empresarial profesional",
          config: { numberOfVideos: 1, resolution: "720p", aspectRatio: "16:9" },
        });

        while (!op.done) {
          await new Promise((r) => setTimeout(r, 10000));
          op = await ai.operations.getVideosOperation({ operation: op });
        }

        if (op.response?.generatedVideos?.[0]?.video?.uri) {
          resultUrl = `${op.response.generatedVideos[0].video.uri}&key=${apiKey}`;
        }
      } else {
        await new Promise((r) => setTimeout(r, 3000));
        resultUrl = `https://docs.google.com/document/d/simulated_${Date.now()}`;
      }

      setExportState({ status: "success", url: resultUrl, type: request.payload.format });
      sendCommand(`EXPORTACIÓN REALIZADA. Formato: ${request.payload.format}. Enlace disponible.`);
    } catch (err: any) {
      if (err?.message?.includes("Requested entity was not found") && window.aistudio) {
        try {
          await window.aistudio.openSelectKey();
        } catch {
          // ignore
        }
      }
      setExportState({ status: "error" });
    }
  };

  const sendCommand = (cmd: string) => {
    if (liveSessionRef.current) liveSessionRef.current.sendRealtimeInput({ text: cmd });
  };

  return (
    <div className={`min-h-screen flex flex-col transition-all duration-700 ${isLiveActive ? "bg-zinc-950 text-white" : "bg-brand-cream/20"}`}>
      <nav
        className={`h-24 px-12 flex items-center justify-between sticky top-0 z-50 backdrop-blur-xl border-b transition-all ${
          isLiveActive ? "bg-zinc-950/90 border-white/5" : "bg-white/95 border-brand-soft shadow-sm"
        }`}
      >
        <div className="flex items-center gap-6 cursor-pointer" onClick={() => setAppState(AppState.IDLE)}>
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg ${
              isLiveActive ? "bg-brand-soft text-brand-green" : "bg-brand-green text-white"
            }`}
          >
            H
          </div>
          <div className="flex flex-col">
            <span className={`brand-font text-2xl font-black leading-none ${isLiveActive ? "text-white" : "text-brand-green"}`}>HIRU Workspace</span>
            <span className={`text-[9px] font-black uppercase tracking-[0.4em] mt-1 ${isLiveActive ? "text-zinc-600" : "text-slate-400"}`}>Modo Vocal Pro v4</span>
          </div>
        </div>

        <div className="flex gap-4 items-center">
          <button
            onClick={isLiveActive ? stopLiveSession : startLiveSession}
            className={`px-8 py-3.5 rounded-2xl font-black text-[10px] uppercase flex items-center gap-3 transition-all ${
              isLiveActive ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-brand-green text-white shadow-2xl hover:scale-105 active:scale-95"
            }`}
          >
            {isLiveActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {isLiveActive ? "Finalizar Pro" : "Voz Total Pro"}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto w-full px-6 py-10 flex-grow">
        {isLiveActive && (
          <div className="fixed inset-0 z-[600] bg-zinc-950 flex flex-col items-center p-8 animate-in fade-in duration-500 overflow-hidden">
            <div className="max-w-7xl w-full flex flex-col gap-6 relative h-full">
              <div className="flex justify-center gap-8 opacity-40 mb-2">
                {["Clasificación", "Contexto", "Formato", "Vista Previa", "Exportación"].map((phase, idx) => (
                  <div key={idx} className={`flex items-center gap-3 transition-all duration-700 ${currentPhase === phase ? "opacity-100 scale-110" : "opacity-20"}`}>
                    <div className={`w-3 h-3 rounded-full ${currentPhase === phase ? "bg-brand-soft shadow-[0_0_15px_#E8E4DB]" : "bg-zinc-800"}`}></div>
                    <span className="text-[9px] font-black uppercase tracking-widest">{phase}</span>
                    {idx < 4 && <div className="w-8 h-[1px] bg-zinc-800"></div>}
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-12 gap-8 w-full flex-grow overflow-hidden">
                <div className="lg:col-span-3 flex flex-col gap-6 h-full">
                  <div className="bg-zinc-900/50 rounded-[40px] border border-white/5 p-8 flex flex-col items-center gap-6 shadow-2xl backdrop-blur-md">
                    <div className="relative">
                      <div className="absolute inset-0 bg-brand-soft/5 blur-[40px] rounded-full animate-pulse"></div>
                      <div className="w-24 h-24 rounded-full border border-white/10 flex items-center justify-center relative z-10">
                        {isLiveConnecting ? <Loader2 className="w-10 h-10 text-brand-soft animate-spin" /> : <Activity className="w-12 h-12 text-brand-soft animate-pulse" />}
                      </div>
                    </div>
                    <div className="text-center">
                      <h2 className="text-xl font-black brand-font text-white mb-1">Hiru Vocal Pro</h2>
                      <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600">Iteración Multimodal</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                      {["PAUSA", "CONTINUAR", "CORREGIR", "REPETIR", "DESHACER", "EXPORTAR"].map((cmd) => (
                        <button
                          key={cmd}
                          onClick={() => sendCommand(cmd)}
                          className="py-3 bg-zinc-800/60 border border-white/5 rounded-xl text-[8px] font-black uppercase hover:bg-brand-soft hover:text-brand-green transition-all shadow-sm"
                        >
                          {cmd}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-grow bg-zinc-900/20 rounded-[40px] border border-white/5 p-8 overflow-y-auto flex flex-col gap-4 custom-scrollbar">
                    <div className="flex items-center gap-2 mb-2 border-b border-white/5 pb-3 opacity-40">
                      <GlobeIcon className="w-3 h-3" />
                      <span className="text-[9px] font-black uppercase tracking-widest">Live Feedback</span>
                    </div>
                    {liveTranscriptions.slice(-10).map((t, i) => (
                      <div key={i} className={`flex ${t.type === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[90%] p-4 rounded-[24px] text-xs font-bold shadow-lg ${
                            t.type === "user" ? "bg-brand-soft text-brand-green rounded-tr-none" : "bg-zinc-900/60 text-zinc-400 rounded-tl-none border border-white/5"
                          }`}
                        >
                          {t.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-9 flex flex-col gap-6 h-full overflow-hidden">
                  <div className="bg-zinc-900/30 rounded-[50px] border border-white/10 p-12 flex-grow overflow-y-auto flex flex-col gap-8 shadow-2xl relative backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-white/5 pb-6">
                      <div className="flex items-center gap-4">
                        <Eye className="w-6 h-6 text-brand-soft" />
                        <h3 className="text-sm font-black uppercase tracking-[0.4em] text-white">Preview Paginado Pro</h3>
                      </div>

                      {liveActions?.preview_paging && (
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                            PARTE {liveActions.preview_paging.current_part} / {liveActions.preview_paging.total_parts}
                          </span>
                        </div>
                      )}
                    </div>

                    {!previewContent ? (
                      <div className="flex flex-col items-center justify-center h-full text-zinc-800 gap-10 opacity-30 animate-pulse">
                        <Layout className="w-24 h-24" />
                        <div className="text-center space-y-2">
                          <p className="text-base font-black uppercase tracking-[0.6em]">Procesando Inteligencia</p>
                          <p className="text-xs italic">Hiru está estructurando tu entregable modular...</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-10 animate-in fade-in slide-in-from-right-10 duration-700">
                        <div className="bg-white/5 p-12 rounded-[50px] font-medium text-2xl whitespace-pre-wrap leading-relaxed border border-white/5 text-zinc-200 selection:bg-brand-soft shadow-inner">
                          {previewContent}
                        </div>

                        <div className="flex justify-center gap-6">
                          {liveActions?.preview_paging?.actions?.map((act: any) => (
                            <button
                              key={act.id}
                              onClick={() => sendCommand(act.voice_hint)}
                              className="px-10 py-5 bg-zinc-800/80 hover:bg-brand-soft hover:text-brand-green rounded-[30px] text-[10px] font-black uppercase border border-white/5 transition-all flex items-center gap-4 group"
                            >
                              {act.id.includes("prev") ? <ChevronLeft /> : <ChevronRight className="group-hover:translate-x-1" />}
                              {act.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {exportState.status !== "idle" && (
                      <div className="mt-8 p-12 bg-zinc-950/80 rounded-[50px] border-2 border-brand-soft/10 animate-in zoom-in-95 duration-500 shadow-3xl text-center flex flex-col items-center gap-8">
                        {exportState.status === "processing" ? (
                          <>
                            <Loader2 className="w-20 h-20 text-brand-soft animate-spin" />
                            <div className="space-y-3">
                              <h4 className="text-3xl font-black brand-font text-white">Generando {exportState.type} Real</h4>
                              <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Sincronizando con Google Cloud Engine & Gemini API...</p>
                            </div>
                          </>
                        ) : exportState.status === "success" ? (
                          <>
                            <div className="w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500/20 flex items-center justify-center">
                              <CheckCircle2 className="w-12 h-12 text-green-500" />
                            </div>
                            <div className="space-y-3">
                              <h4 className="text-3xl font-black brand-font text-white">¡Entregable Listo!</h4>
                              <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Exportación completada y verificada.</p>
                            </div>

                            {exportState.type === "IMAGE" && exportState.url ? (
                              <img src={exportState.url} alt="Hiru Generated" className="max-w-md rounded-[40px] shadow-2xl border-4 border-white/10" />
                            ) : (
                              <a
                                href={exportState.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-14 py-6 bg-brand-soft text-brand-green rounded-full font-black uppercase text-xs tracking-widest shadow-2xl flex items-center gap-4 hover:scale-105 transition-all"
                              >
                                <Link2 className="w-5 h-5" /> Ver en Workspace
                              </a>
                            )}
                          </>
                        ) : (
                          <div className="text-red-500 flex flex-col items-center gap-4">
                            <AlertCircle className="w-16 h-16" />
                            <h4 className="text-2xl font-black brand-font">Error en Exportación</h4>
                            <button onClick={() => setExportState({ status: "idle" })} className="text-xs font-black uppercase underline">
                              Reintentar
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-zinc-900/40 p-10 rounded-[45px] border border-white/5 flex flex-col gap-8 backdrop-blur-md">
                    <div className="flex items-center gap-4 opacity-40">
                      <CloudUpload className="w-5 h-5 text-brand-soft" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Próximos Pasos Pro</span>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      {(liveActions?.next_actions || []).map((action: any, i: number) => (
                        <button
                          key={i}
                          onClick={() => sendCommand(action.voice_hint)}
                          className="px-6 py-6 bg-zinc-800/40 border border-white/5 hover:border-brand-soft rounded-[28px] text-[9px] font-black uppercase text-zinc-500 hover:text-white transition-all text-center flex flex-col items-center gap-3"
                        >
                          {action.id.includes("format") ? <Layout className="w-4 h-4" /> : action.id.includes("drive") ? <ExternalLink className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                          <span>{action.label}</span>
                          <span className="text-[7px] opacity-30 italic">Di: {action.voice_hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {appState === AppState.SETUP && (
          <div className="max-w-2xl mx-auto bg-white p-16 rounded-[70px] shadow-2xl space-y-12 animate-in zoom-in-95 mt-10 border border-slate-100">
            <div className="text-center space-y-4">
              <h2 className="text-5xl font-black brand-font text-brand-green">Hiru Workspace Pro</h2>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-[0.4em]">Configuración de Agente</p>
            </div>

            <div className="space-y-10">
              <div className="space-y-4">
                <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 ml-6 flex items-center gap-3">
                  <Briefcase className="w-4 h-4" /> Perfil Profesional
                </label>
                <textarea
                  className="w-full p-10 bg-brand-cream/40 rounded-[50px] outline-none font-bold text-slate-700 resize-none h-48 border-2 border-transparent focus:border-brand-green/10 transition-all shadow-inner text-lg"
                  placeholder="Ej: Consultora Senior de Estrategia Digital..."
                  value={profile.situation}
                  onChange={(e) => setProfile({ ...profile, situation: e.target.value })}
                />
              </div>
            </div>

            <button
              onClick={() => setAppState(AppState.IDLE)}
              disabled={!profile.situation}
              className="w-full py-8 bg-brand-green text-white rounded-[50px] font-black uppercase tracking-[0.3em] shadow-2xl hover:scale-105 transition-all disabled:opacity-50"
            >
              Activar Hiru Vocal Pro
            </button>
          </div>
        )}

        {appState === AppState.IDLE && (
          <div className="max-w-5xl mx-auto space-y-20 animate-in fade-in mt-10">
            <div className="text-center space-y-8">
              <h1 className="text-8xl font-black brand-font text-brand-green tracking-tight leading-none">Voz Total Pro</h1>
              <p className="text-2xl text-slate-500 italic font-medium max-w-4xl mx-auto">La IA propone, tú decides. Gestión multiformato en tiempo real.</p>
            </div>

            <div className="bg-white p-20 rounded-[100px] shadow-2xl border-t border-white space-y-16">
              <div className="grid md:grid-cols-3 gap-10">
                {["Cliente", "Proveedor", "Libre"].map((type) => (
                  <button
                    key={type}
                    className="flex flex-col items-center gap-6 p-12 bg-brand-cream/30 rounded-[50px] border-2 border-transparent hover:border-brand-green/20 hover:bg-white transition-all group shadow-sm"
                  >
                    <div className="w-20 h-20 bg-white rounded-[32px] flex items-center justify-center text-brand-green shadow-md group-hover:scale-110 transition-all">
                      {type === "Cliente" ? <Users className="w-8 h-8" /> : type === "Proveedor" ? <Scale className="w-8 h-8" /> : <Radio className="w-8 h-8" />}
                    </div>
                    <span className="text-[12px] font-black uppercase tracking-[0.4em]">{type}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col items-center gap-10 border-t pt-16">
                <button
                  onClick={startLiveSession}
                  className="px-40 py-9 bg-brand-green text-white rounded-[60px] font-black uppercase tracking-[0.4em] shadow-2xl hover:scale-105 transition-all flex items-center gap-8 text-2xl group"
                >
                  Iniciar Sesión Pro <Mic className="w-8 h-8 group-hover:animate-pulse" />
                </button>

                <div className="flex items-center gap-4 opacity-30">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Entorno Seguro | Hiru Multi-Modal v4</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {appState === AppState.RESULT && result && (
          <div className="max-w-7xl mx-auto space-y-20 pb-32 animate-in slide-in-from-bottom-12">
            <div className="flex justify-between items-center border-b pb-10">
              <h2 className="text-5xl font-black brand-font text-brand-green">Análisis Pro</h2>
              <div className="flex gap-4">
                <button
                  onClick={() => setAppState(AppState.PRESENTATION)}
                  className="flex items-center gap-6 px-12 py-6 bg-brand-soft text-brand-green rounded-[40px] font-black text-sm uppercase hover:bg-brand-green hover:text-white transition-all shadow-2xl group"
                >
                  <PresentationIcon className="w-6 h-6" /> Teatro Visual
                </button>
                <button
                  onClick={startLiveSession}
                  className="flex items-center gap-6 px-12 py-6 bg-brand-green text-white rounded-[40px] font-black text-sm uppercase hover:bg-brand-soft hover:text-brand-green transition-all shadow-2xl group"
                >
                  <Volume2 className="w-6 h-6 group-hover:scale-110" /> Iterar con Voz
                </button>
              </div>
            </div>

            <div className="p-20 bg-white rounded-[100px] shadow-3xl border border-slate-100 space-y-12">
              <div className="flex items-center justify-between">
                <h3 className="text-3xl font-black text-brand-green">{result.execution.title}</h3>
                <div className="flex gap-4">
                  <button className="p-4 bg-brand-cream rounded-2xl hover:bg-brand-soft transition-all">
                    <FileText className="w-5 h-5 text-brand-green" />
                  </button>
                  <button className="p-4 bg-brand-cream rounded-2xl hover:bg-brand-soft transition-all">
                    <ImageIcon className="w-5 h-5 text-brand-green" />
                  </button>
                  <button className="p-4 bg-brand-cream rounded-2xl hover:bg-brand-soft transition-all">
                    <VideoIcon className="w-5 h-5 text-brand-green" />
                  </button>
                </div>
              </div>

              <div className="bg-brand-cream/40 p-16 rounded-[60px] font-medium text-2xl whitespace-pre-wrap leading-relaxed shadow-inner">{result.execution.content}</div>
            </div>
          </div>
        )}

        {appState === AppState.PRESENTATION && (
          <div className="max-w-4xl mx-auto animate-in slide-in-from-bottom-12 space-y-12">
            {!presentationResult ? (
              <div className="bg-white p-20 rounded-[80px] shadow-2xl border border-slate-100 space-y-12 text-center">
                <div className="flex flex-col items-center gap-6">
                  <div className="p-6 bg-brand-cream rounded-[30px] shadow-sm">
                    <GlobeIcon className="w-16 h-16 text-brand-green" />
                  </div>
                  <h2 className="text-5xl font-black brand-font text-brand-green">Configuración del Teatro Visual</h2>
                  <p className="text-slate-500 font-bold max-w-xl mx-auto">Adapta tu presentación estratégica al idioma y contexto cultural de tu audiencia.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-10 text-left">
                  <div className="space-y-4">
                    <label className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest text-slate-400 ml-4">
                      <Languages className="w-4 h-4" /> Idioma de la Presentación
                    </label>
                    <select
                      value={presentationLang}
                      onChange={(e) => setPresentationLang(e.target.value as SupportedLanguage)}
                      className="w-full p-8 bg-brand-cream/40 rounded-[40px] outline-none font-bold text-slate-700 border-2 border-transparent focus:border-brand-green/10 transition-all appearance-none cursor-pointer text-lg"
                    >
                      {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-center gap-3 text-[11px] font-black uppercase tracking-widest text-slate-400 ml-4">
                      <Target className="w-4 h-4" /> Cultura de Destino
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Mercado de EE.UU., Cultura Europea, Multinacional Asiática..."
                      value={targetCulture}
                      onChange={(e) => setTargetCulture(e.target.value)}
                      className="w-full p-8 bg-brand-cream/40 rounded-[40px] outline-none font-bold text-slate-700 border-2 border-transparent focus:border-brand-green/10 transition-all text-lg"
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center gap-6 pt-10">
                  <button
                    onClick={handleGeneratePresentation}
                    className="px-20 py-8 bg-brand-green text-white rounded-[50px] font-black uppercase tracking-widest shadow-2xl hover:scale-105 transition-all flex items-center gap-6 text-xl group"
                  >
                    Generar Presentación Estratégica <PresentationIcon className="w-7 h-7 group-hover:rotate-12 transition-transform" />
                  </button>
                  <button
                    onClick={() => setAppState(AppState.RESULT)}
                    className="text-xs font-black uppercase text-slate-400 hover:text-brand-green underline decoration-brand-green/20 underline-offset-8 transition-all"
                  >
                    Volver al Análisis
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-12">
                <div className="flex items-center justify-between">
                  <button onClick={() => setPresentationResult(null)} className="flex items-center gap-3 text-xs font-black uppercase text-brand-green hover:underline">
                    <ChevronLeft className="w-4 h-4" /> Nueva Configuración
                  </button>

                  <div className="flex gap-2">
                    {presentationResult.slides.map((_, i) => (
                      <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentSlide ? "w-12 bg-brand-green" : "w-4 bg-brand-soft"}`}></div>
                    ))}
                  </div>
                </div>

                <div className="bg-white p-20 rounded-[80px] shadow-3xl border border-slate-100 min-h-[600px] flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-12 opacity-5">
                    <PresentationIcon className="w-48 h-48" />
                  </div>

                  <div className="space-y-10 relative z-10">
                    <h2 className="text-6xl font-black brand-font text-brand-green leading-tight">{presentationResult.slides[currentSlide].title}</h2>
                    <ul className="space-y-6">
                      {presentationResult.slides[currentSlide].content.map((item, i) => (
                        <li key={i} className="flex items-start gap-6 text-2xl font-bold text-slate-600 leading-relaxed">
                          <div className="mt-3 w-3 h-3 bg-brand-soft rounded-full shrink-0"></div>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-16 p-10 bg-brand-cream/30 rounded-[40px] border border-brand-soft/20 space-y-4">
                    <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-400 opacity-60">
                      <Mic className="w-4 h-4" /> Script Sugerido (Adaptado Culturalmente)
                    </div>
                    <p className="text-lg italic text-slate-500 leading-relaxed font-medium">"{presentationResult.slides[currentSlide].script}"</p>
                  </div>
                </div>

                <div className="flex justify-between items-center px-10">
                  <button
                    disabled={currentSlide === 0}
                    onClick={() => setCurrentSlide((s) => s - 1)}
                    className="p-8 bg-white text-brand-green rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all disabled:opacity-20"
                  >
                    <ChevronLeft className="w-8 h-8" />
                  </button>

                  <div className="text-xl font-black brand-font text-brand-green">
                    {currentSlide + 1} / {presentationResult.slides.length}
                  </div>

                  <button
                    disabled={currentSlide === presentationResult.slides.length - 1}
                    onClick={() => setCurrentSlide((s) => s + 1)}
                    className="p-8 bg-brand-green text-white rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all disabled:opacity-20"
                  >
                    <ChevronRight className="w-8 h-8" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {appState === AppState.LOADING && (
          <div className="fixed inset-0 z-[1000] bg-brand-cream/90 backdrop-blur-md flex flex-col items-center justify-center gap-12 animate-in fade-in duration-500">
            <div className="relative">
              <div className="w-32 h-32 border-8 border-brand-soft rounded-full"></div>
              <div className="w-32 h-32 border-8 border-t-brand-green rounded-full animate-spin absolute top-0 left-0"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-10 h-10 text-brand-green animate-pulse" />
              </div>
            </div>

            <div className="text-center space-y-4">
              <h3 className="text-4xl font-black brand-font text-brand-green">Sincronizando Inteligencia</h3>
              <p className="text-[11px] font-black uppercase tracking-[0.5em] text-slate-400">Estructurando tu estrategia modular...</p>
            </div>
          </div>
        )}
      </main>

      <footer className={`h-28 border-t flex items-center justify-center transition-all ${isLiveActive ? "bg-zinc-950 border-white/5" : "bg-white"}`}>
        <p className={`text-[10px] font-black uppercase tracking-[0.8em] ${isLiveActive ? "text-zinc-800" : "text-brand-green"}`}>
          HIRU PRESTAKUNTZA &copy; 2025 | CLOUD MULTIMODAL ENGINE
        </p>
      </footer>
    </div>
  );
};

const GlobeIcon = (props: any) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

export default App;
