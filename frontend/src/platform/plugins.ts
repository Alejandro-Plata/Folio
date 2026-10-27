// Plugins de Android (código Kotlin en frontend/android/…/es/folio/app) tal y
// como los ve la interfaz. Solo se llaman en Android.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface PickedFile { path: string; name: string; size: number }

export interface FolioCorePlugin {
  call(o: { method: string; args: string }): Promise<{ result: string }>;
  addListener(name: 'event', cb: (e: { name: string; payload: string }) => void): Promise<PluginListenerHandle>;
}

export interface FolioFilesPlugin {
  pick(o: { mimeTypes: string[]; multiple?: boolean }): Promise<{ files: PickedFile[] }>;
  openUrl(o: { url: string }): Promise<void>;
  saveAs(o: { path: string; name: string; mimeType: string }): Promise<{ saved: boolean }>;
  share(o: { path: string; mimeType: string; title?: string }): Promise<void>;
  open(o: { path: string; mimeType: string }): Promise<void>;
  tempPath(o: { name: string }): Promise<{ path: string }>;
  consumeShared(): Promise<{ files: PickedFile[] }>;
}

export interface FolioPrintPlugin {
  print(o: { html: string; title: string }): Promise<void>;
  toPdf(o: { html: string; path: string; paper: string; landscape: boolean }): Promise<void>;
}

export interface FolioSpeechPlugin {
  available(): Promise<{ onDevice: boolean; any: boolean }>;
  start(o: { language: string; partial: boolean }): Promise<{ text: string }>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  addListener(name: 'partial', cb: (e: { text: string }) => void): Promise<PluginListenerHandle>;
}

export interface FolioAuthPlugin {
  googleToken(): Promise<{ token: string }>;
}

export interface FolioSecretsPlugin {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
}

export const FolioCore = registerPlugin<FolioCorePlugin>('FolioCore');
export const FolioFiles = registerPlugin<FolioFilesPlugin>('FolioFiles');
export const FolioPrint = registerPlugin<FolioPrintPlugin>('FolioPrint');
export const FolioSpeech = registerPlugin<FolioSpeechPlugin>('FolioSpeech');
export const FolioAuth = registerPlugin<FolioAuthPlugin>('FolioAuth');
export const FolioSecrets = registerPlugin<FolioSecretsPlugin>('FolioSecrets');
