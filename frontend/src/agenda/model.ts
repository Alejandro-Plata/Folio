// Tipos de la agenda (espejo de internal/agenda en Go).

export interface Repeat {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** 1 = lunes … 7 = domingo. */
  weekdays?: number[];
  until?: string;
  except?: string[];
  done?: string[];
}

export interface Task {
  id: string;
  title: string;
  typeId: string;
  date: string;
  start?: string;
  minutes?: number;
  notes?: string;
  repeat?: Repeat | null;
  seriesId?: string;
  topicId?: string;
  kind?: '' | 'study' | 'review' | 'mock' | 'rest';
  auto?: boolean;
  pinned?: boolean;
  done: boolean;
  docId?: string;
  updated?: string;
  /** Solo en ocurrencias de una serie: id de la tarea madre. */
  occurrenceOf?: string;
  /** Evento compartido de un círculo (vive en el servidor; su id empieza por «c:»). */
  circle?: CircleRef;
}

export interface CircleRef {
  id: string;
  name?: string;
  kind?: 'friends' | 'couple';
  color?: string;
  /** Nombre de quien lo creó. */
  by?: string;
  mine?: boolean;
  proposalId?: string;
}

export interface TaskType {
  id: string;
  name: string;
  priority: number;
  color: string;
  icon: string;
  pattern: 'solid' | 'stripes' | 'dots' | 'grid';
  countsAsStudy: boolean;
  fixed: boolean;
}

export interface FsrsCard {
  Due: string;
  Stability: number;
  Difficulty: number;
  Reps: number;
  Lapses: number;
  /** 0 nuevo · 1 aprendiendo · 2 repaso · 3 reaprendiendo */
  State: number;
  LastReview: string;
  ElapsedDays?: number;
  ScheduledDays?: number;
}

export interface Topic {
  id: string;
  number: number;
  title: string;
  block?: string;
  weight: number;
  studyMinutes: number;
  docId?: string;
  /** Apuntes adjuntos (los gestiona el backend: AgendaAttachFiles / AgendaRemoveTopicFile). */
  files?: TopicFile[];
  memory?: FsrsCard;
  studied?: string;
  archived?: boolean;
}

export interface TopicFile {
  id: string;
  name: string;
  path: string;
  size: number;
  added: string;
}

/** Memoria de un tema en una fecha (curva del olvido). */
export interface Forecast {
  topicId: string;
  new: boolean;
  reps: number;
  lapses: number;
  lastReview?: string;
  due?: string;
  /** Probabilidad de recordarlo en la fecha consultada (0–1). */
  retention: number;
  /** Retención objetivo con la que se programan los repasos. */
  target: number;
  /** Recuerdo estimado día a día desde el último repaso. */
  curve: number[] | null;
  curveFrom?: string;
  /** Valoración (1–4) → fecha del siguiente repaso. */
  next: Record<string, string>;
}

export interface Session {
  id: string;
  taskId?: string;
  topicId?: string;
  typeId?: string;
  kind?: string;
  date: string;
  start?: string;
  minutes: number;
  rating?: number;
  score?: number | null;
  note?: string;
}

export interface Window { start: string; end: string }

export interface PlanSettings {
  examDate: string;
  capacityMode: 'hours' | 'window' | 'both';
  capacity: Record<string, number>;
  windows: Record<string, Window>;
  restDays: number[];
  blockMinutes: number;
  reviewMinutes: number;
  breakMinutes: number;
  retention: number;
  finalPhaseDays: number;
  minReviews: number;
  suggestions: boolean;
  dayStart: string;
  dayEnd: string;
}

export interface TemplateTask { weekday: number; title: string; typeId: string; start?: string; minutes?: number; notes?: string }
export interface WeekTemplate { id: string; name: string; tasks: TemplateTask[] }

export interface AgendaInitData {
  today: string;
  types: TaskType[];
  settings: PlanSettings;
  topics: Topic[];
  templates: WeekTemplate[];
}

export interface PlanReport {
  created: number;
  reviews: number;
  studies: number;
  mocks: number;
  horizon: string;
  finishDate: string;
  unscheduled: number;
  shortfall: number;
  extraPerDay: number;
  warnings: string[] | null;
}

export type Scope = 'one' | 'following' | 'all';
export type ViewKind = 'list' | 'day' | '3days' | 'week' | 'month' | 'year';

export interface DictationInfo {
  model: string;
  modelReady: boolean;
  modelPath: string;
  modelSize: number;
  engineReady: boolean;
  enginePath: string;
  nativeRecord: boolean;
  recorder: string;
  recording: boolean;
  downloading: boolean;
}
