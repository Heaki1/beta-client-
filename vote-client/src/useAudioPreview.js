// osu! beatmap preview clips. One clip at a time, site-wide — starting a new
// one stops the last. preview_url from the osu! API is protocol-relative
// ("//b.ppy.sh/preview/123.mp3"), so it needs https:// prepended.
import { useCallback, useEffect, useRef, useState } from "react";

export default function useAudioPreview() {
  const audioRef = useRef(null);
  const [playingUrl, setPlayingUrl] = useState(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingUrl(null);
  }, []);

  useEffect(() => stop, [stop]); // stop on unmount

  const toggle = useCallback(
    (url) => {
      if (!url) return;
      if (playingUrl === url) {
        stop();
        return;
      }
      if (audioRef.current) audioRef.current.pause();

      const audio = new Audio(url.startsWith("//") ? `https:${url}` : url);
      audio.volume = 0.35;
      audio.addEventListener("ended", () => setPlayingUrl(null));
      audio.play().catch(() => setPlayingUrl(null)); // autoplay blocked, or dead link
      audioRef.current = audio;
      setPlayingUrl(url);
    },
    [playingUrl, stop]
  );

  return { playingUrl, toggle, stop };
}
