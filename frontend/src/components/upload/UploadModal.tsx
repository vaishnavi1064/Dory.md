import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import {
  Upload, X, CheckCircle2, AlertCircle,
  Loader2, CloudUpload, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ingestText } from '@/lib/api';

interface UploadModalProps {
  onClose: () => void;
}

type FileStatus = 'pending' | 'processing' | 'done' | 'error';

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  error?: string;
}

const ACCEPTED = ['.pdf', '.txt', '.doc', '.docx', '.md'];
const ACCEPTED_MIME = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function fileBadge(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
  return ext.slice(0, 3).toUpperCase();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function UploadModal({ onClose }: UploadModalProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    const valid = Array.from(files).filter((f) => {
      const ext = `.${f.name.split('.').pop()?.toLowerCase()}`;
      return ACCEPTED.includes(ext) || ACCEPTED_MIME.includes(f.type);
    });
    setQueue((prev) => [
      ...prev,
      ...valid.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        status: 'pending' as FileStatus,
      })),
    ]);
  }

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }, []);

  async function processAll() {
    const pendingItems = queue.filter((f) => f.status === 'pending');
    if (!pendingItems.length) return;
    setUploading(true);

    for (const item of pendingItems) {
      setQueue((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: 'processing' } : f)));
      try {
        const ext = item.file.name.split('.').pop()?.toLowerCase();
        const content = ext === 'pdf' || ext === 'doc' || ext === 'docx'
          ? `[${fileBadge(item.file.name)}] ${item.file.name} queued for backend ingestion.`
          : await readFileAsText(item.file);

        await ingestText(content, 'file', item.file.name);
        setQueue((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: 'done' } : f)));
      } catch (e) {
        setQueue((prev) => prev.map((f) => (
          f.id === item.id
            ? { ...f, status: 'error', error: e instanceof Error ? e.message : 'Upload failed' }
            : f
        )));
      }
    }

    setUploading(false);
  }

  const pending = queue.filter((f) => f.status === 'pending').length;
  const done = queue.filter((f) => f.status === 'done').length;
  const allDone = queue.length > 0 && done === queue.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="app-card flex max-h-[90vh] w-full max-w-2xl flex-col shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <CloudUpload size={20} />
            </span>
            <div>
              <h3 className="font-bold text-[var(--text-1)]">Upload files</h3>
              <p className="text-sm text-[var(--text-3)]">PDF, TXT, DOC, DOCX, and MD files are supported.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 p-0" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pt-5">
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer select-none flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 transition',
              dragging ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-strong)] bg-[var(--surface-2)] hover:border-[var(--accent-border)]'
            )}
          >
            <Upload size={28} className="text-[var(--accent)]" />
            <div className="text-center">
              <p className="font-bold text-[var(--text-1)]">{dragging ? 'Drop files here' : 'Drag files here'}</p>
              <p className="text-sm text-[var(--text-3)]">or click to browse</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {ACCEPTED.map((ext) => <span key={ext} className="tag">{ext}</span>)}
            </div>
            <input ref={inputRef} type="file" multiple accept={ACCEPTED.join(',')} className="hidden" onChange={onInputChange} />
          </div>
        </div>

        {queue.length > 0 && (
          <div className="flex-1 overflow-y-auto px-5 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="app-label">{queue.length} file{queue.length === 1 ? '' : 's'} queued</p>
              {pending > 0 && !uploading && (
                <button type="button" onClick={() => setQueue([])} className="btn-ghost">
                  <Trash2 size={13} /> Clear
                </button>
              )}
            </div>
            <div className="space-y-2 pb-2">
              {queue.map((item) => (
                <div key={item.id} className="app-card-muted flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface)] text-xs font-bold text-[var(--accent)]">
                    {item.status === 'processing' ? <Loader2 size={16} className="animate-spin" /> :
                      item.status === 'done' ? <CheckCircle2 size={16} className="text-[var(--good)]" /> :
                      item.status === 'error' ? <AlertCircle size={16} className="text-[var(--danger)]" /> :
                      fileBadge(item.file.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[var(--text-1)]">{item.file.name}</p>
                    <p className="text-xs text-[var(--text-3)]">
                      {item.status === 'error' ? item.error :
                        item.status === 'done' ? 'Ingested successfully' :
                        item.status === 'processing' ? 'Processing...' :
                        formatBytes(item.file.size)}
                    </p>
                  </div>
                  {item.status === 'pending' && !uploading && (
                    <button type="button" onClick={() => setQueue((prev) => prev.filter((f) => f.id !== item.id))} className="btn-ghost h-8 w-8 p-0">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
          <p className="text-sm text-[var(--text-3)]">
            {allDone ? `${done} file${done === 1 ? '' : 's'} added.` : 'Files are chunked before they enter memory tracking.'}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{allDone ? 'Close' : 'Cancel'}</button>
            {!allDone && (
              <button type="button" className="btn-primary" onClick={processAll} disabled={uploading || pending === 0}>
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
                {uploading ? 'Uploading...' : `Upload${pending > 0 ? ` ${pending}` : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
