Bikorch Media Downloader binaries
=================================

Bikorch prepares the official yt-dlp and FFmpeg engines automatically
the first time you download. They are stored in the app data folder:

  Windows: %APPDATA%\Bikorch\bin

You can also place architecture-matched binaries into:

  resources/bin/<platform>/<arch>/

Examples:

  resources/bin/win32/x64/yt-dlp.exe
  resources/bin/win32/x64/ffmpeg.exe

For packaged builds, electron-builder copies this folder to
<app resources>/bin.

Official sources only:

  yt-dlp  https://github.com/yt-dlp/yt-dlp
  FFmpeg  https://ffmpeg.org/download.html

yt-dlp is Unlicense. FFmpeg is LGPL/GPL depending on the build — do
not bundle a GPL FFmpeg build unless you intend to comply with that
license.

The app never imports browser cookies or third-party credentials to
bypass access restrictions.
