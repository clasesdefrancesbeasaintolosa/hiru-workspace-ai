
export interface User {
  id: string;
  email: string;
  name: string;
  photo?: string;
  password?: string;
  securityPin?: string;
}

export interface Diagnosis {
  goals: string[];
  gaps: string[];
  risks: string[];
  assumptions: string[];
}

export interface Execution {
  title: string;
  description: string;
  content: string;
  variants: string[];
}

export interface Verification {
  checks: string[];
  improvement: string;
}

export interface AnalysisResponse {
  diagnosis: Diagnosis;
  actionPlan: string[];
  execution: Execution;
  verification: Verification;
}

// Added missing Slide interface for presentation logic
export interface Slide {
  title: string;
  content: string[];
  script: string;
}

// Fixed missing exported member PresentationResponse
export interface PresentationResponse {
  title: string;
  language: string;
  slides: Slide[];
}

export enum AppState {
  SETUP = 'SETUP',
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  RESULT = 'RESULT',
  PRESENTATION = 'PRESENTATION',
  LIVE_STRATEGY = 'LIVE_STRATEGY',
  ERROR = 'ERROR'
}

export interface UserProfile {
  situation: string;
  objective: string;
  focusOrNeed: string;
  level: string;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  type: 'analysis' | 'presentation';
  title: string;
  inputText: string;
  data: any; 
  profile: UserProfile;
}

export type SupportedLanguage = 'es' | 'en' | 'eu';

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  es: 'Castellano',
  en: 'Inglés',
  eu: 'Euskera'
};

export interface LiveTranscription {
  text: string;
  type: 'user' | 'model';
  timestamp: number;
}

export interface ExportRequest {
  status: 'idle' | 'ready' | 'processing' | 'success' | 'error';
  endpoint: string;
  method: 'POST';
  payload: {
    format: 'GOOGLE_DOC' | 'GOOGLE_SHEETS' | 'GOOGLE_SLIDES' | 'PDF' | 'IMAGE' | 'VIDEO';
    title?: string;
    file_name?: string;
    content?: string;
    prompt?: string;
    aspect_ratio?: '1:1' | '9:16' | '16:9' | '4:3' | '3:4';
    resolution?: '720p' | '1080p';
    [key: string]: any;
  };
  voice_hint?: string;
}

export interface LiveActions {
  ui_preferences: { theme: string; contrast: string };
  voice_mode: {
    enabled: boolean;
    global_commands: string[];
  };
  preview_paging: {
    current_part: number;
    total_parts: number;
    actions: Array<{ id: string; label: string; voice_hint: string }>;
  };
  export: ExportRequest;
  open_in_drive: { status: string; hint: string };
  next_actions: Array<{ id: string; label: string; voice_hint: string }>;
}
