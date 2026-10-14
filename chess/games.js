// Turns each PGN block written by the `pgn` shortcode into a Lichess PGN
// Viewer. Loaded as a module, so it runs once however many games a page has.
import LichessPgnViewer from "./pgn-viewer/lichess-pgn-viewer.min.js";

// The viewer's stylesheet goes first in <head> so that main.css, which
// re-themes it, wins at equal specificity. Wait for it to avoid a flash of
// an unstyled board.
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./pgn-viewer/lichess-pgn-viewer.css", import.meta.url);
await new Promise((resolve) => {
  css.onload = css.onerror = resolve;
  document.head.prepend(css);
});

for (const el of document.querySelectorAll(".chess-game__viewer")) {
  const { orientation, ply, moves } = el.dataset;
  const opts = {
    pgn: el.querySelector(".chess-game__pgn").textContent,
    lichess: false,
    showClocks: false,
    menu: {
      getPgn: { enabled: true },
      practiceWithComputer: { enabled: false },
      analysisBoard: { enabled: false },
    },
  };
  if (orientation === "white" || orientation === "black") opts.orientation = orientation;
  if (ply) opts.initialPly = ply === "last" ? "last" : parseInt(ply, 10);
  if (moves) opts.showMoves = moves === "false" ? false : moves;
  LichessPgnViewer(el, opts);
}
