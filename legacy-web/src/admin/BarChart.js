/**
 * BarChart — a small SVG column chart for the overview (signups per week,
 * revenue per month). Values are labelled on the bars, so no axis is needed.
 */
import { Html } from '../core/Html.js';

export class BarChart {
  /**
   * @param {{label: string, value: number}[]} points
   * @param {{format?: (v: number) => string, title: string}} opts
   */
  static svg(points, { format = (v) => String(v), title }) {
    const w = 640, h = 200, padTop = 28, padBottom = 34, gap = 10;
    const max = Math.max(1, ...points.map((p) => p.value));
    const bw = (w - gap * (points.length + 1)) / Math.max(1, points.length);
    const bars = points.map((p, i) => {
      const x = gap + i * (bw + gap);
      const bh = Math.round(((h - padTop - padBottom) * p.value) / max);
      const y = h - padBottom - bh;
      return `<g>
        <rect x="${x}" y="${y}" width="${bw}" height="${Math.max(bh, p.value ? 2 : 0)}" rx="4" class="bar"/>
        ${p.value ? `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" class="bar-value">${Html.escape(format(p.value))}</text>` : ''}
        <text x="${x + bw / 2}" y="${h - 12}" text-anchor="middle" class="bar-label">${Html.escape(p.label)}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="${Html.escape(title)}">${bars}<line x1="0" x2="${w}" y1="${h - padBottom}" y2="${h - padBottom}" class="axis"/></svg>`;
  }
}
