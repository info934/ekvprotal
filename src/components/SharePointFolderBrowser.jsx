import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  ensureEntityFolder,
  getEntityStorageFolder,
  listEntityStorageFolder,
  uploadEntityStorageFile,
} from '@/lib/documentStorageService';

const formatSize = (bytes) => {
  const value = Number(bytes || 0);
  if (!value) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—';

const SharePointFolderBrowser = ({ entityType, entity, canEdit = false }) => {
  const { toast } = useToast();
  const inputRef = useRef(null);
  const [rootFolder, setRootFolder] = useState(null);
  const [connection, setConnection] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const currentFolder = breadcrumbs[breadcrumbs.length - 1] || rootFolder;

  const sortedItems = useMemo(() => [...items].sort((left, right) => {
    if (Boolean(left.folder) !== Boolean(right.folder)) return left.folder ? -1 : 1;
    return String(left.name || '').localeCompare(String(right.name || ''), 'cs');
  }), [items]);

  const loadFolder = useCallback(async (folder, activeConnection) => {
    if (!folder?.id || !activeConnection) return;
    setLoading(true);
    setError('');
    try {
      const result = await listEntityStorageFolder({
        entityType,
        folderId: folder.id,
        connection: activeConnection,
      });
      if (!result.supported) {
        setError('Procházení struktury je dostupné po připojení SharePointu.');
        setItems([]);
      } else {
        setItems(result.items);
      }
    } catch (loadError) {
      setError(loadError.message || 'Obsah SharePoint složky se nepodařilo načíst.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  const initialize = useCallback(async () => {
    if (!entity?.id) return;
    setLoading(true);
    setError('');
    try {
      let mapping = await getEntityStorageFolder({ entityType, entityId: entity.id });
      let folder;
      let activeConnection = mapping?.connection;

      if (mapping?.external_folder_id) {
        const hasManagedStructure = mapping.metadata?.structureVersion === 1
          && Array.isArray(mapping.metadata?.structure)
          && mapping.metadata.structure.length > 0;

        if (canEdit && !hasManagedStructure) {
          const prepared = await ensureEntityFolder({
            entityType,
            entityId: entity.id,
            code: entity.code,
            name: entity.name,
            connection: activeConnection,
          });
          activeConnection = prepared.connection;
          mapping = await getEntityStorageFolder({ entityType, entityId: entity.id });
        }

        folder = {
          id: mapping?.external_folder_id || mapping?.externalFolderId,
          name: entity.code || entity.name || 'Dokumenty',
          webUrl: mapping?.external_web_url || mapping?.webUrl,
        };
      } else if (canEdit) {
        const prepared = await ensureEntityFolder({
          entityType,
          entityId: entity.id,
          code: entity.code,
          name: entity.name,
          connection: activeConnection || undefined,
        });
        activeConnection = prepared.connection;
        folder = {
          id: prepared.externalFolderId || prepared.folderId,
          name: entity.code || entity.name || 'Dokumenty',
          webUrl: prepared.webUrl,
        };
      } else {
        throw new Error('Složka ještě nebyla vytvořena. Požádejte uživatele s právem editace.');
      }

      setConnection(activeConnection);
      setRootFolder(folder);
      setBreadcrumbs([folder]);
      await loadFolder(folder, activeConnection);
    } catch (initializationError) {
      setError(initializationError.message || 'SharePoint složku se nepodařilo připravit.');
      setLoading(false);
    }
  }, [canEdit, entity, entityType, loadFolder]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const openFolder = async (item) => {
    const folder = { id: item.id, name: item.name, webUrl: item.webUrl };
    setBreadcrumbs((current) => [...current, folder]);
    await loadFolder(folder, connection);
  };

  const openBreadcrumb = async (index) => {
    const next = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(next);
    await loadFolder(next[next.length - 1], connection);
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !currentFolder?.id) return;

    setUploading(true);
    try {
      await uploadEntityStorageFile({
        entityType,
        entityId: entity.id,
        folderId: currentFolder.id,
        file,
        connection,
      });
      toast({ title: 'Soubor nahrán', description: `Soubor ${file.name} je uložen ve složce ${currentFolder.name}.` });
      await loadFolder(currentFolder, connection);
    } catch (uploadError) {
      toast({ title: 'Nahrání se nepodařilo', description: uploadError.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FolderOpen className="h-4 w-4 text-blue-600" />
            SharePoint dokumenty
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-500">
            {breadcrumbs.map((folder, index) => (
              <React.Fragment key={folder.id}>
                {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                <button
                  type="button"
                  onClick={() => openBreadcrumb(index)}
                  className="max-w-[220px] truncate rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900"
                >
                  {folder.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadFolder(currentFolder, connection)} disabled={loading || !currentFolder}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="sr-only">Obnovit</span>
          </Button>
          {rootFolder?.webUrl && (
            <Button variant="outline" size="sm" onClick={() => window.open(rootFolder.webUrl, '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="mr-2 h-4 w-4" />
              SharePoint
            </Button>
          )}
          {canEdit && (
            <>
              <input ref={inputRef} type="file" className="hidden" onChange={handleUpload} />
              <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading || !currentFolder}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Nahrát sem
              </Button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="px-4 py-8 text-center text-sm text-rose-700">{error}</div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Načítám obsah složky…
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Tato složka je prázdná.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Název</th>
                <th className="w-36 px-4 py-2.5">Typ</th>
                <th className="w-36 px-4 py-2.5">Velikost</th>
                <th className="w-48 px-4 py-2.5">Změněno</th>
                <th className="w-24 px-4 py-2.5 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => item.folder ? openFolder(item) : window.open(item.webUrl, '_blank', 'noopener,noreferrer')}
                      className="flex max-w-full items-center gap-2 font-medium text-slate-900 hover:text-blue-700"
                    >
                      {item.folder ? <Folder className="h-4 w-4 shrink-0 fill-blue-50 text-blue-600" /> : <File className="h-4 w-4 shrink-0 text-slate-500" />}
                      <span className="truncate">{item.name}</span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{item.folder ? 'Složka' : item.file?.mimeType || 'Soubor'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{item.folder ? '—' : formatSize(item.size)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{formatDate(item.lastModifiedDateTime)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => window.open(item.webUrl, '_blank', 'noopener,noreferrer')}>
                      <ExternalLink className="h-4 w-4" />
                      <span className="sr-only">Otevřít</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default SharePointFolderBrowser;
