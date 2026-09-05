import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../stores';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { downloadUpdate, ignoreUpdate, onUpdaterEvent, quitAndInstall } from '../../desktopBridge';

interface UpdateDialogState {
  status: 'available' | 'downloading' | 'downloaded' | 'error';
  version: string;
  currentVersion: string;
  message: string;
  percent?: number;
  transferred?: number;
  total?: number;
}

function formatBytes(value = 0): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UpdateNotification() {
  const addToast = useStore((s) => s.addToast);
  const [dialog, setDialog] = useState<UpdateDialogState | null>(null);

  useEffect(() => onUpdaterEvent((event) => {
    if (event.type === 'checking') return;

    if (event.type === 'available' && event.version) {
      setDialog({
        status: 'available',
        version: event.version,
        currentVersion: event.currentVersion || '',
        message: event.message || `发现新版本 v${event.version}`,
      });
      return;
    }

    if (event.type === 'downloading') {
      setDialog((prev) => ({
        status: 'downloading',
        version: prev?.version || event.version || '',
        currentVersion: prev?.currentVersion || event.currentVersion || '',
        message: '正在下载更新，请稍候...',
        percent: event.percent,
        transferred: event.transferred,
        total: event.total,
      }));
      return;
    }

    if (event.type === 'downloaded') {
      setDialog((prev) => ({
        status: 'downloaded',
        version: event.version || prev?.version || '',
        currentVersion: prev?.currentVersion || event.currentVersion || '',
        message: event.message || '更新已下载完成',
      }));
      return;
    }

    if (event.type === 'error') {
      setDialog((prev) => {
        if (!prev || prev.status === 'available') {
          return {
            status: 'error',
            version: event.version || '',
            currentVersion: event.currentVersion || '',
            message: event.message || '更新失败',
          };
        }
        return { ...prev, status: 'error', message: event.message || '更新失败' };
      });
      return;
    }

    if (event.type === 'up-to-date' && event.manual) {
      addToast(event.message || '当前已是最新版本', 'success');
    }
  }), [addToast]);

  const close = useCallback(() => setDialog(null), []);

  const handleDownload = useCallback(async () => {
    setDialog((prev) => prev ? { ...prev, status: 'downloading', percent: 0, transferred: 0, total: 0, message: '正在下载更新，请稍候...' } : prev);
    await downloadUpdate();
  }, []);

  const handleIgnore = useCallback(async (version: string) => {
    await ignoreUpdate(version);
    setDialog(null);
    addToast(`已忽略 v${version} 的自动更新提醒`, 'info');
  }, [addToast]);

  const handleInstall = useCallback(() => {
    quitAndInstall();
  }, []);

  const progress = dialog?.status === 'downloading' ? Math.max(0, Math.min(100, dialog.percent || 0)) : 0;

  return (
    <Modal open={Boolean(dialog)} onClose={close} className="w-[440px] max-w-[calc(100vw-32px)]">
      {dialog && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              dialog.status === 'error'
                ? 'bg-danger/10 text-danger'
                : dialog.status === 'downloaded'
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-accent/10 text-accent'
            }`}>
              {dialog.status === 'error' ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              ) : dialog.status === 'downloaded' ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-text">
                {dialog.status === 'error' ? '更新失败' :
                 dialog.status === 'downloaded' ? '更新已就绪' :
                 dialog.status === 'downloading' ? '正在下载更新' : '发现新版本'}
              </h3>
              <p className="text-sm text-text-muted mt-1">{dialog.message}</p>
              {dialog.version && dialog.currentVersion && dialog.status === 'available' && (
                <p className="text-xs text-text-secondary mt-2 bg-bg-secondary rounded-lg px-3 py-2">
                  v{dialog.currentVersion} <span className="mx-1 text-text-muted">→</span>
                  <span className="font-semibold text-accent">v{dialog.version}</span>
                </p>
              )}
            </div>
            {dialog.status !== 'downloading' && (
              <button onClick={close} className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-secondary hover:text-text transition-colors" aria-label="关闭">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>

          {dialog.status === 'downloading' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>{progress}%</span>
                <span>{formatBytes(dialog.transferred)} / {formatBytes(dialog.total)}</span>
              </div>
              <div className="h-2 rounded-full bg-bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {dialog.status === 'available' && (
              <>
                <Button onClick={close}>稍后</Button>
                <Button onClick={() => handleIgnore(dialog.version)}>忽略此版本</Button>
                <Button type="primary" onClick={handleDownload}>立即更新</Button>
              </>
            )}
            {dialog.status === 'downloading' && (
              <>
                <Button onClick={close}>后台下载</Button>
              </>
            )}
            {dialog.status === 'downloaded' && (
              <>
                <Button onClick={close}>稍后重启</Button>
                <Button type="primary" onClick={handleInstall}>立即重启安装</Button>
              </>
            )}
            {dialog.status === 'error' && (
              <Button type="primary" onClick={close}>知道了</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
