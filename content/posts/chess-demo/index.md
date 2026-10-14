---
title: "Chess typesetting demo"
date: 2026-10-14T10:00:00+02:00
draft: true
---

The Opera Game opens quietly: {{< mv "1. e4 e5 2. Nf3 d6 3. d4 Bg4?!" >}} and
after {{< mv "4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4" >}} White is already
threatening mate on f7.

{{< fen fen="rn1qkbnr/ppp2ppp/8/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R b KQkq - 1 6" caption="After 6. Bc4 — Black must stop *Qxf7#*." highlight="f7" arrows="c4f7 f3f7" >}}

Black defends with {{< mv "6...Nf6" >}}, and the finish is the famous
{{< mv "16. Qb8+! Nxb8 17. Rd8#" >}}.

{{< fen fen="1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17" caption="Final position, from Black's side." orientation="black" >}}

The whole game:

{{< pgn caption="Morphy – Duke of Brunswick and Count Isouard, Paris 1858" ply="11" >}}
[Event "Paris"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 {This is a weak move already.} 4. dxe5 Bxf3
5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 {Black is in what's like
a zugzwang position here.} (9. Qxb7 Qb4+ 10. Qxb4 Bxb4) 9... b5? 10. Nxb5! cxb5
11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7! Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7
16. Qb8+!! Nxb8 17. Rd8# 1-0
{{< /pgn >}}
