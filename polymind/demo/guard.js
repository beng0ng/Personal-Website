// Value guard for the browser bot: the same check as polytopia/agents/guard.py.
// Wraps a SearchAgent (ai.js). When the lookahead did not run, it scores the
// position after every legal move with the value head (one batched call); if a
// move beats the chosen one by `gap`, it plays out the rest of the turn greedily
// for the chosen move and the best `top` alternatives, and switches only when an
// alternative still wins by `margin`. Positions come from what the bot knows
// (knownCopy) and simulated moves reveal no new tiles. Exploring ruins is random,
// so a chosen EXAMINE is kept and EXAMINE is never a replacement.
// Not used by index.html yet: the Training Ground keeps plain Alpha1+ until the
// guard's evaluation is approved.
(function (root) {
  const Poly = root.Poly || (typeof require !== "undefined" ? require("./engine.js") : null);
  const AI = root.PolyAI || (typeof require !== "undefined" ? require("./ai.js") : null);
  const { AK, UA } = Poly;

  class ValueGuard {
    constructor(net, { gap = 0.25, margin = 0.1, top = 3, search = {} } = {}) {
      Object.assign(this, { net, gap, margin, top });
      this.search = new AI.SearchAgent(net, search);
      this.stats = { checked: 0, flagged: 0, changed: 0, ms: 0 };
    }
    screen(game, pid) {
      const s = this.search, base = s.knownCopy(game, pid);
      base._exploreTile = () => {};
      const codec = Poly.codec(game.R), vals = new Map(), pending = [];
      for (const a of game.legalActions()) {
        if (a.kind === AK.UNIT && a.arg === UA.EXAMINE) continue;
        const i = codec.encode(a, game.width);
        if (a.kind === AK.END_TURN) { pending.push([i, a, base]); continue; }
        const g = AI.cloneGame(base, Math.floor(s.rand() * 4294967296));
        g.apply(a);
        if (g.done) vals.set(i, { a, v: g.result.winner === pid ? 1 : -1 });
        else pending.push([i, a, g]);
      }
      if (pending.length) AI.policies(this.net, pending.map((q) => q[2]), pid).forEach((r, j) => vals.set(pending[j][0], { a: pending[j][1], v: r.value }));
      return { vals, base };
    }
    playout(base, pid, a) {
      const s = this.search;
      if (a.kind === AK.END_TURN) return AI.policies(this.net, [base], pid)[0].value;
      const g = AI.cloneGame(base, Math.floor(s.rand() * 4294967296));
      g.apply(a);
      return s.continueTurn(g, pid, true);
    }
    act(game, actionsThisTurn = 0) {
      const s = this.search, pid = game.current, searched = s.stats.searched;
      const a = s.act(game, actionsThisTurn);
      if (s.stats.searched !== searched || (a.kind === AK.UNIT && a.arg === UA.EXAMINE) || a.kind === AK.END_TURN && actionsThisTurn >= 250) return a;
      const t0 = (typeof performance !== "undefined" ? performance : Date).now();
      const done = (r) => { this.stats.ms += (typeof performance !== "undefined" ? performance : Date).now() - t0; return r; };
      this.stats.checked++;
      const { vals, base } = this.screen(game, pid), chosen = Poly.codec(game.R).encode(a, game.width);
      if (vals.size < 2 || !vals.has(chosen)) return done(a);
      const order = [...vals.keys()].sort((x, y) => vals.get(y).v - vals.get(x).v);
      if (vals.get(order[0]).v - vals.get(chosen).v < this.gap) return done(a);
      this.stats.flagged++;
      const alts = order.filter((i) => i !== chosen).slice(0, this.top);
      const mine = this.playout(base, pid, a);
      let best = null, bestScore = -Infinity;
      for (const i of alts) { const sc = this.playout(base, pid, vals.get(i).a); if (sc > bestScore) { best = vals.get(i).a; bestScore = sc; } }
      if (bestScore < mine + this.margin) return done(a);
      this.stats.changed++;
      return done(best);
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { ValueGuard };
  else root.PolyAI.ValueGuard = ValueGuard;
})(typeof globalThis !== "undefined" ? globalThis : this);
