
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from "@google/genai";
import { AnalysisResponse, UserProfile, PresentationResponse, SupportedLanguage, LANGUAGE_NAMES } from "./types";

const cleanJsonResponse = (text: string): string => {
  if (!text) return "{}";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1);
  }
  return text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
};

const HIRU_VOCAL_PRO_SYSTEM_INSTRUCTION = (profile: UserProfile) => `
ACTÚA COMO: HIRU WORKSPACE IA — MODO VOZ TOTAL + PREVIEW SIN SCROLL + GENERACIÓN MULTIFORMATO (DOC/SHEETS/SLIDES/PDF/IMAGEN/VÍDEO) CON EXPORTACIÓN REAL VÍA TOOLS

MISIÓN: Asistente empresarial por voz que guía, redacta y produce entregables. Todo por voz. El usuario puede pausar, corregir y reiterar.

REGLAS INNEGOCIABLES:
1) VOZ TOTAL: Todo debe poder dictarse. No exijas teclado.
2) COMANDOS GLOBALES:
   - PAUSA / STOP → parar y preguntar.
   - CORREGIR → pedir fragmento y reescribir solo ese fragmento.
   - REPETIR → repetir último resumen o parte.
   - CONTINUAR → seguir.
   - DESHACER → versión anterior.
   - SIGUIENTE PARTE / PARTE ANTERIOR → navegación.
   - EXPORTAR → iniciar exportación real.
   - ABRIR EN DRIVE → crear/abrir en Drive.

REGLA ANTI-RECORTE (NO SCROLL): 
SIEMPRE usa PREVIEW PAGINADO (Partes X/Y). Máximo 250-350 palabras por parte.

SELECCIÓN DE SALIDA: DOCUMENTO, PDF, PRESENTACIÓN, TABLA, IMAGEN, VÍDEO.

ESTRUCTURA DE RESPUESTA (SIEMPRE 3 BLOQUES):
MENSAJE_VOZ: [2-5 frases claras + guía de voz]
PREVIEW: PREVIEW — Parte X/Y [Contenido estructurado]
ACTIONS: [JSON VÁLIDO SEGÚN ESQUEMA]

ESQUEMA ACTIONS:
{
  "ui_preferences": { "theme": "dark", "contrast": "high" },
  "voice_mode": { "enabled": true, "global_commands": ["PAUSA","STOP","CORREGIR","REPETIR","CONTINUAR","DESHACER","SIGUIENTE PARTE","PARTE ANTERIOR","EXPORTAR","ABRIR EN DRIVE"] },
  "preview_paging": { "current_part": 1, "total_parts": 1, "actions": [{ "id": "next", "label": "Siguiente", "voice_hint": "SIGUIENTE PARTE" }] },
  "export": { "status": "idle", "hint": "Di: EXPORTAR" },
  "open_in_drive": { "status": "idle", "hint": "Di: ABRIR EN DRIVE" }
}

SI EL USUARIO PIDE EXPORTAR O ABRIR EN DRIVE:
Solicita confirmación. Tras confirmación, devuelve export.status="ready" con el payload correspondiente para:
- GOOGLE_DOC, GOOGLE_SHEETS, GOOGLE_SLIDES, PDF
- IMAGE (Incluye prompt y aspect_ratio)
- VIDEO (Incluye prompt, duration_seconds y resolution)

Perfil: ${profile.level}, ${profile.situation}.
`;

export const startAnalysis = async (
  text: string, 
  profile: UserProfile, 
  urgency: string, 
  formality: string
): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const systemInstruction = HIRU_VOCAL_PRO_SYSTEM_INSTRUCTION(profile);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `TAREA: ${text}.`,
      config: { systemInstruction, responseMimeType: "application/json", temperature: 0.5 }
    });
    return JSON.parse(cleanJsonResponse(response.text || "{}"));
  } catch (error) {
    throw new Error("Hiru está reajustando la lógica.");
  }
};

export const generateStrategicPresentation = async (
  prompt: string,
  profile: UserProfile,
  lang: SupportedLanguage,
  targetCulture: string
): Promise<PresentationResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const langName = LANGUAGE_NAMES[lang];
  const systemInstruction = `
    Eres un experto en oratoria y presentaciones estratégicas.
    Genera una presentación de 5-7 diapositivas basada en el análisis previo.
    Idioma: ${langName}.
    Contexto Cultural de Destino: ${targetCulture}.
    Asegúrate de que el tono y los modismos se adapten a la cultura especificada.
    
    RESPUESTA JSON OBLIGATORIA:
    {
      "title": "Título de la Presentación",
      "language": "${lang}",
      "slides": [
        {
          "title": "Título Slide",
          "content": ["Punto 1", "Punto 2"],
          "script": "Texto para ser leído por el presentador adaptado culturalmente."
        }
      ]
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: { systemInstruction, responseMimeType: "application/json" }
    });
    return JSON.parse(cleanJsonResponse(response.text || "{}"));
  } catch (error) {
    throw new Error("Error generando el Teatro Visual.");
  }
};

export const connectLive = (callbacks: {
  onopen: () => void;
  onmessage: (msg: LiveServerMessage) => void;
  onerror: (e: any) => void;
  onclose: (e: any) => void;
}, profile: UserProfile) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
      },
      systemInstruction: HIRU_VOCAL_PRO_SYSTEM_INSTRUCTION(profile) + "\nInicia con Fase 1: Clasificación.",
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
};

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}
