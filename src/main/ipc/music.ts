import { BrowserWindow, dialog, ipcMain } from 'electron'
import { MUSIC_DOWNLOAD_IPC } from '@shared/contracts/downloads'
import { MUSIC_IPC } from '@shared/contracts/music'
import {
  addLink,
  addPlaylistTracks,
  addToQueue,
  checkTrackAvailable,
  ensurePlayableTrack,
  readPlaybackMedia,
  clearQueue,
  connectSpotify,
  createPlaylist,
  deletePlaylist,
  disconnectSpotify,
  getPlaybackSnapshot,
  getPlaylistTracks,
  getQueue,
  getSettings,
  getSpotifyAccessToken,
  importPaths,
  importSpotifyTopTracks,
  importSpotifyTrackById,
  resolveSpotifyPlayback,
  librarySummary,
  listFavorites,
  listHistory,
  listLibrary,
  listPlaylists,
  listRecentlyPlayed,
  listSpotifyTopTracks,
  openExternalUrl,
  recordListen,
  recordPlay,
  removeFromQueue,
  removePlaylistTrack,
  removeTrack,
  renamePlaylist,
  reorderPlaylist,
  reorderQueue,
  savePlaybackSnapshot,
  searchLibrary,
  setQueue,
  setSpotifyClientId,
  spotifyStatusForRenderer,
  toggleFavorite,
  updateSettings,
  updateTrackDuration
} from '../music/service'
import {
  parseAddLink,
  parseCreatePlaylist,
  parseImportPaths,
  parsePlaybackSnapshot,
  parsePlaylistTracks,
  parseRecordListen,
  parseRecordPlay,
  parseRenamePlaylist,
  parseReorderPlaylist,
  parseReorderQueue,
  parseSearchQuery,
  parseSettingsUpdate,
  parseSpotifyClientId,
  parseSpotifyResolveRequest,
  parseSpotifySourceId,
  parseSpotifyTopRequest,
  parseStorageMode,
  parseEnsurePlayable,
  parseTrackId,
  parseUpdateDuration
} from '../music/validation'
import {
  analyzeDownloadUrl,
  cancelDownloadJob,
  clearDownloadHistory,
  deleteDownloadJob,
  copyDownloadPath,
  getDownloadEngineStatus,
  getDownloadSettings,
  installDownloadEngine,
  listDownloadJobs,
  openDownloadFile,
  openDownloadFolder,
  openDownloadsDirectory,
  pickDownloadFolder,
  retryDownloadJob,
  startDownload,
  updateDownloadSettings
} from '../music/downloader/service'
import {
  parseAnalysisPreview,
  parseAnalyzeUrl,
  parseDownloadRequest,
  parseDownloadSettingsUpdate,
  parseJobId
} from '../music/downloader/validation'

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender.isDestroyed()) throw new Error('Unauthorized sender')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('Unauthorized sender')
}

async function pickAudioPaths(
  event: Electron.IpcMainInvokeEvent,
  properties: Array<'openFile' | 'openDirectory' | 'multiSelections'>
): Promise<string[] | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = {
    title: properties.includes('openDirectory') ? 'Select music folder' : 'Select audio files',
    properties,
    filters: properties.includes('openFile')
      ? [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] }]
      : undefined
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths
}

export function registerMusicHandlers(): void {
  ipcMain.handle(MUSIC_IPC.LIBRARY_LIST, () => listLibrary())

  ipcMain.handle(MUSIC_IPC.LIBRARY_IMPORT_FILES, async (event, payload: unknown) => {
    const mode = parseStorageMode(payload)
    const picked = await pickAudioPaths(event, ['openFile', 'multiSelections'])
    if (!picked) return { imported: 0, skipped: 0, failed: 0, tracks: [], errors: [], canceled: true }
    return importPaths(picked, mode)
  })

  ipcMain.handle(MUSIC_IPC.LIBRARY_IMPORT_FOLDER, async (event, payload: unknown) => {
    const mode = parseStorageMode(payload)
    const picked = await pickAudioPaths(event, ['openDirectory'])
    if (!picked) return { imported: 0, skipped: 0, failed: 0, tracks: [], errors: [], canceled: true }
    return importPaths(picked, mode)
  })

  ipcMain.handle(MUSIC_IPC.LIBRARY_IMPORT_PATHS, async (_event, payload: unknown) => {
    const parsed = parseImportPaths(payload)
    if (!parsed) throw new Error('Invalid import request')
    return importPaths(parsed.paths, parsed.mode)
  })

  ipcMain.handle(MUSIC_IPC.LIBRARY_REMOVE, async (_event, payload: unknown) => {
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid track id')
    return { ok: await removeTrack(id) }
  })

  ipcMain.handle(MUSIC_IPC.LIBRARY_UPDATE_DURATION, (_event, payload: unknown) => {
    const parsed = parseUpdateDuration(payload)
    if (!parsed) throw new Error('Invalid duration update')
    return { ok: updateTrackDuration(parsed.trackId, parsed.durationMs) }
  })

  ipcMain.handle(MUSIC_IPC.LIBRARY_SUMMARY, () => librarySummary())

  ipcMain.handle(MUSIC_IPC.SEARCH, (_event, payload: unknown) => searchLibrary(parseSearchQuery(payload)))

  ipcMain.handle(MUSIC_IPC.FAVORITES_LIST, () => listFavorites())

  ipcMain.handle(MUSIC_IPC.FAVORITES_TOGGLE, (_event, payload: unknown) => {
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid track id')
    return { favorited: toggleFavorite(id) }
  })

  ipcMain.handle(MUSIC_IPC.HISTORY_LIST, () => listHistory())

  ipcMain.handle(MUSIC_IPC.HISTORY_RECORD_PLAY, (_event, payload: unknown) => {
    const parsed = parseRecordPlay(payload)
    if (!parsed) throw new Error('Invalid play record')
    return recordPlay(parsed)
  })

  ipcMain.handle(MUSIC_IPC.HISTORY_RECORD_LISTEN, (_event, payload: unknown) => {
    const parsed = parseRecordListen(payload)
    if (!parsed) throw new Error('Invalid listen record')
    recordListen(parsed.historyId, parsed.listenedMs)
    return { ok: true }
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_LIST, () => listPlaylists())

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_CREATE, (_event, payload: unknown) => {
    const parsed = parseCreatePlaylist(payload)
    if (!parsed) throw new Error('Invalid playlist')
    return createPlaylist(parsed.name)
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_RENAME, (_event, payload: unknown) => {
    const parsed = parseRenamePlaylist(payload)
    if (!parsed) throw new Error('Invalid rename request')
    return { ok: renamePlaylist(parsed.id, parsed.name) }
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_DELETE, (_event, payload: unknown) => {
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid playlist id')
    return { ok: deletePlaylist(id) }
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_ADD_TRACKS, (_event, payload: unknown) => {
    const parsed = parsePlaylistTracks(payload)
    if (!parsed) throw new Error('Invalid playlist tracks request')
    addPlaylistTracks(parsed.playlistId, parsed.trackIds)
    return { ok: true }
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_REMOVE_TRACK, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid request')
    const body = payload as Record<string, unknown>
    const playlistId = typeof body.playlistId === 'string' ? body.playlistId : null
    const trackId = typeof body.trackId === 'string' ? body.trackId : null
    if (!playlistId || !trackId) throw new Error('Invalid remove request')
    removePlaylistTrack(playlistId, trackId)
    return { ok: true }
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_REORDER, (_event, payload: unknown) => {
    const parsed = parseReorderPlaylist(payload)
    if (!parsed) throw new Error('Invalid reorder request')
    reorderPlaylist(parsed.playlistId, parsed.trackIds)
    return { ok: true }
  })

  ipcMain.handle(MUSIC_IPC.PLAYLISTS_GET_TRACKS, (_event, payload: unknown) => {
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid playlist id')
    return getPlaylistTracks(id)
  })

  ipcMain.handle(MUSIC_IPC.QUEUE_GET, () => getQueue())
  ipcMain.handle(MUSIC_IPC.QUEUE_SET, (_event, payload: unknown) => {
    const parsed = parseReorderQueue(payload)
    if (!parsed) throw new Error('Invalid queue request')
    setQueue(parsed.trackIds)
    return { ok: true }
  })
  ipcMain.handle(MUSIC_IPC.QUEUE_ADD, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid queue request')
    const trackIds = Array.isArray((payload as Record<string, unknown>)['trackIds'])
      ? ((payload as Record<string, unknown>)['trackIds'] as unknown[]).filter(
          (id): id is string => typeof id === 'string'
        )
      : []
    addToQueue(trackIds)
    return { ok: true }
  })
  ipcMain.handle(MUSIC_IPC.QUEUE_REMOVE, (_event, payload: unknown) => {
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid track id')
    removeFromQueue(id)
    return { ok: true }
  })
  ipcMain.handle(MUSIC_IPC.QUEUE_CLEAR, () => {
    clearQueue()
    return { ok: true }
  })
  ipcMain.handle(MUSIC_IPC.QUEUE_REORDER, (_event, payload: unknown) => {
    const parsed = parseReorderQueue(payload)
    if (!parsed) throw new Error('Invalid queue reorder request')
    reorderQueue(parsed.trackIds)
    return { ok: true }
  })

  ipcMain.handle(MUSIC_IPC.GET_SETTINGS, () => getSettings())
  ipcMain.handle(MUSIC_IPC.UPDATE_SETTINGS, (_event, payload: unknown) => {
    const updates = parseSettingsUpdate(payload)
    if (!updates) throw new Error('Invalid settings update')
    return updateSettings(updates)
  })

  ipcMain.handle(MUSIC_IPC.GET_PLAYBACK, () => getPlaybackSnapshot())
  ipcMain.handle(MUSIC_IPC.SAVE_PLAYBACK, (_event, payload: unknown) => {
    const snapshot = parsePlaybackSnapshot(payload)
    if (!snapshot) throw new Error('Invalid playback snapshot')
    savePlaybackSnapshot(snapshot)
    return { ok: true }
  })

  ipcMain.handle(MUSIC_IPC.CHECK_TRACK, (_event, payload: unknown) => {
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid track id')
    return checkTrackAvailable(id)
  })

  ipcMain.handle(MUSIC_IPC.ENSURE_PLAYABLE, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const parsed = parseEnsurePlayable(payload)
    if (!parsed) throw new Error('Invalid track id')
    return ensurePlayableTrack(parsed.trackId, parsed.force)
  })

  ipcMain.handle(MUSIC_IPC.LIBRARY_READ_PLAYBACK, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseTrackId(payload)
    if (!id) throw new Error('Invalid track id')
    return readPlaybackMedia(id)
  })

  ipcMain.handle(MUSIC_IPC.ADD_LINK, async (_event, payload: unknown) => {
    const url = parseAddLink(payload)
    if (!url) throw new Error('Invalid URL')
    return addLink(url)
  })

  ipcMain.handle(MUSIC_IPC.OPEN_EXTERNAL, (_event, payload: unknown) => {
    const url = parseAddLink(payload)
    if (!url) throw new Error('Invalid URL')
    return openExternalUrl(url)
  })

  ipcMain.handle(MUSIC_IPC.SPOTIFY_STATUS, () => spotifyStatusForRenderer())

  ipcMain.handle(MUSIC_IPC.SPOTIFY_SET_CLIENT_ID, (_event, payload: unknown) => {
    const clientId = parseSpotifyClientId(payload)
    if (!clientId) throw new Error('Invalid Spotify Client ID')
    setSpotifyClientId(clientId)
    return spotifyStatusForRenderer()
  })

  ipcMain.handle(MUSIC_IPC.SPOTIFY_CONNECT, () => connectSpotify())
  ipcMain.handle(MUSIC_IPC.SPOTIFY_DISCONNECT, () => disconnectSpotify())
  ipcMain.handle(MUSIC_IPC.SPOTIFY_ACCESS_TOKEN, () => getSpotifyAccessToken())
  ipcMain.handle(MUSIC_IPC.SPOTIFY_TOP_TRACKS, async (_event, payload: unknown) => {
    const request = parseSpotifyTopRequest(payload)
    return listSpotifyTopTracks(request.timeRange, request.limit)
  })
  ipcMain.handle(MUSIC_IPC.SPOTIFY_IMPORT_TOP, async (_event, payload: unknown) => {
    const request = parseSpotifyTopRequest(payload)
    return importSpotifyTopTracks(request.timeRange, request.limit)
  })
  ipcMain.handle(MUSIC_IPC.SPOTIFY_IMPORT_ONE, async (_event, payload: unknown) => {
    const sourceId = parseSpotifySourceId(payload)
    if (!sourceId) throw new Error('Invalid Spotify track')
    return importSpotifyTrackById(sourceId)
  })
  ipcMain.handle(MUSIC_IPC.SPOTIFY_RESOLVE_PLAYBACK, async (_event, payload: unknown) => {
    const request = parseSpotifyResolveRequest(payload)
    if (!request) throw new Error('Invalid Spotify track')
    return resolveSpotifyPlayback(request)
  })

  ipcMain.handle('music:recently-played', () => listRecentlyPlayed())

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.ENGINE_STATUS, (event) => {
    assertTrustedSender(event)
    return getDownloadEngineStatus()
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.ENGINE_INSTALL, async (event) => {
    assertTrustedSender(event)
    return installDownloadEngine()
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.ANALYZE, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const url = parseAnalyzeUrl(payload)
    if (!url) throw new Error('Invalid or disallowed URL')
    return analyzeDownloadUrl(url)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.START, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const request = parseDownloadRequest(payload)
    if (!request) throw new Error('Invalid download request')
    const preview = parseAnalysisPreview(payload)
    return startDownload(request, preview)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.LIST, (event) => {
    assertTrustedSender(event)
    return listDownloadJobs()
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.CANCEL, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseJobId(payload)
    if (!id) throw new Error('Invalid job id')
    return { ok: await cancelDownloadJob(id) }
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.DELETE, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseJobId(payload)
    if (!id) throw new Error('Invalid job id')
    return deleteDownloadJob(id)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.RETRY, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseJobId(payload)
    if (!id) throw new Error('Invalid job id')
    return retryDownloadJob(id)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.CLEAR_HISTORY, (event) => {
    assertTrustedSender(event)
    return clearDownloadHistory()
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.GET_SETTINGS, (event) => {
    assertTrustedSender(event)
    return getDownloadSettings()
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.UPDATE_SETTINGS, (event, payload: unknown) => {
    assertTrustedSender(event)
    const updates = parseDownloadSettingsUpdate(payload)
    if (!updates) throw new Error('Invalid download settings')
    return updateDownloadSettings(updates)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.PICK_FOLDER, async (event) => {
    assertTrustedSender(event)
    return pickDownloadFolder(event)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.OPEN_FILE, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseJobId(payload)
    if (!id) throw new Error('Invalid job id')
    return openDownloadFile(id)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.OPEN_FOLDER, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseJobId(payload)
    if (!id) throw new Error('Invalid job id')
    return openDownloadFolder(id)
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.OPEN_DIR, async (event) => {
    assertTrustedSender(event)
    return openDownloadsDirectory()
  })

  ipcMain.handle(MUSIC_DOWNLOAD_IPC.COPY_PATH, (event, payload: unknown) => {
    assertTrustedSender(event)
    const id = parseJobId(payload)
    if (!id) throw new Error('Invalid job id')
    return copyDownloadPath(id)
  })
}
