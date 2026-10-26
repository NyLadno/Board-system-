import { makeShape, makeSticky, makeText, makeFrame, makeConnector } from './core/scene.js';
import { textObjectHeight } from './render/draw.js';
import { getLang } from './i18n.js';

const L = (ru, en) => (getLang() === 'ru' ? ru : en);
const Y = '#fff1a8', O = '#ffd0a6', P = '#ffb8c6', V = '#d8c4ff', BL = '#b8dcff', G = '#b9f0d0', LG = '#e3f59a';

// Небольшой построитель: рамки уходят на задний план, остальное идёт сверху в порядке создания
class Builder {
  constructor() { this.objs = []; this.z = 0; this.fz = -100000; }

  frame(x, y, w, h, title, fill = '#ffffff') {
    const f = makeFrame(x, y, w, h, title);
    f.s.fill = fill;
    f.z = this.fz++;
    this.objs.push(f);
    return f;
  }

  sticky(x, y, text, color = Y, size = 150) {
    const o = makeSticky(x, y, color, size);
    o.text = text;
    o.ts.size = 20;
    o.z = ++this.z;
    this.objs.push(o);
    return o;
  }

  text(x, y, w, text, size = 28, { bold = true, align = 'left', color = '#1a1a1a' } = {}) {
    const o = makeText(x, y, w);
    o.text = text;
    o.ts.size = size;
    o.ts.bold = bold;
    o.ts.align = align;
    o.ts.color = color;
    o.h = textObjectHeight(o);
    o.z = ++this.z;
    this.objs.push(o);
    return o;
  }

  shape(kind, x, y, w, h, text, fill = '#ffffff', stroke = '#1a1a1a') {
    const o = makeShape(kind, x, y, w, h);
    o.text = text;
    o.s.fill = fill;
    o.s.stroke = stroke;
    o.ts.size = 20;
    o.z = ++this.z;
    this.objs.push(o);
    return o;
  }

  conn(a, b, pa = 'c', pb = 'c', kind = 'elbow') {
    const c = makeConnector({ id: a.id, port: pa }, { id: b.id, port: pb }, kind, true);
    c.z = ++this.z;
    this.objs.push(c);
    return c;
  }
}

// Колонки одинаковой ширины с рамками-заголовками и стикерами внутри
function columns(b, titles, fills, notes, { w = 480, h = 820, gap = 40, noteColor = [Y] } = {}) {
  const total = titles.length * w + (titles.length - 1) * gap;
  const x0 = -total / 2, y0 = -h / 2;
  titles.forEach((title, i) => {
    const x = x0 + i * (w + gap);
    b.frame(x, y0, w, h, title, fills[i % fills.length]);
    (notes[i] || []).forEach((text, k) => {
      b.sticky(x + (w - 170) / 2, y0 + 40 + k * 210, text, noteColor[i % noteColor.length], 170);
    });
  });
}

function quadrants(b, titles, fills, notes) {
  const w = 560, h = 400, gap = 40;
  titles.forEach((title, i) => {
    const x = -w - gap / 2 + (i % 2) * (w + gap);
    const y = -h - gap / 2 + Math.floor(i / 2) * (h + gap);
    b.frame(x, y, w, h, title, fills[i]);
    (notes[i] || []).forEach((text, k) => b.sticky(x + 40 + k * 190, y + 60, text, Y, 160));
  });
}

export const TEMPLATES = [
  {
    id: 'blank',
    name: () => L('Пустая доска', 'Blank board'),
    build: () => [],
  },
  {
    id: 'cells',
    bg: 'cells',
    name: () => L('В клетку', 'Squared paper'),
    build: () => [],
  },
  {
    id: 'kanban',
    name: () => L('Канбан', 'Kanban'),
    build() {
      const b = new Builder();
      columns(b, [L('Сделать', 'To do'), L('В работе', 'In progress'), L('Готово', 'Done')],
        ['#eef2ff', '#fff7e6', '#ebfbee'],
        [[L('Описать задачу', 'Describe the task'), L('Оценить сроки', 'Estimate the work'), L('Согласовать', 'Get approval')], [L('Сделать прототип', 'Build a prototype')], [L('Собрать требования', 'Collect requirements')]],
        { noteColor: [BL, O, G] });
      return b.objs;
    },
  },
  {
    id: 'retro',
    name: () => L('Ретроспектива', 'Retrospective'),
    build() {
      const b = new Builder();
      columns(b, [L('Что получилось', 'What went well'), L('Что мешало', 'What did not go well'), L('Что попробуем', 'What we will try')],
        ['#ebfbee', '#fff0f3', '#eef2ff'],
        [[L('Быстрые релизы', 'Fast releases')], [L('Долгие ревью', 'Slow reviews')], [L('Парное программирование', 'Pair programming')]],
        { noteColor: [G, P, BL] });
      return b.objs;
    },
  },
  {
    id: 'swot',
    name: () => 'SWOT',
    build() {
      const b = new Builder();
      quadrants(b, [L('Сильные стороны', 'Strengths'), L('Слабые стороны', 'Weaknesses'), L('Возможности', 'Opportunities'), L('Угрозы', 'Threats')],
        ['#ebfbee', '#fff0f3', '#eef2ff', '#fff7e6'],
        [[L('Сильная команда', 'Strong team')], [L('Мало ресурсов', 'Limited budget')], [L('Новый рынок', 'New market')], [L('Конкуренты', 'Competitors')]]);
      return b.objs;
    },
  },
  {
    id: 'eisenhower',
    name: () => L('Матрица Эйзенхауэра', 'Eisenhower matrix'),
    build() {
      const b = new Builder();
      quadrants(b, [L('Срочно и важно: сделать', 'Urgent and important: do'), L('Важно, не срочно: запланировать', 'Important, not urgent: schedule'),
        L('Срочно, не важно: делегировать', 'Urgent, not important: delegate'), L('Не срочно, не важно: убрать', 'Not urgent, not important: drop')],
        ['#fff0f3', '#ebfbee', '#fff7e6', '#f1f3f5'],
        [[L('Дедлайн сегодня', 'Deadline today')], [L('Обучение', 'Learning')], [L('Письма', 'Emails')], [L('Лента новостей', 'News feed')]]);
      return b.objs;
    },
  },
  {
    id: 'mindmap',
    name: () => L('Майнд-карта', 'Mind map'),
    build() {
      const b = new Builder();
      const center = b.shape('ellipse', -140, -70, 280, 140, L('Главная тема', 'Main topic'), '#4262ff', '#2b44c9');
      center.ts.color = '#ffffff';
      center.ts.bold = true;
      center.ts.size = 24;
      const names = [L('Цели', 'Goals'), L('Задачи', 'Tasks'), L('Ресурсы', 'Resources'), L('Риски', 'Risks'), L('Сроки', 'Timeline'), L('Команда', 'Team')];
      const fills = [Y, G, BL, P, V, O];
      names.forEach((n, i) => {
        const a = (i / names.length) * Math.PI * 2 - Math.PI / 2;
        const cx = Math.cos(a) * 520, cy = Math.sin(a) * 330;
        const s = b.shape('round', cx - 100, cy - 40, 200, 80, n, fills[i]);
        s.ts.size = 22;
        s.ts.bold = true;
        const c = b.conn(center, s, 'c', 'c', 'curve');
        c.head = 'none';
        c.s.sw = 3;
      });
      return b.objs;
    },
  },
  {
    id: 'flowchart',
    name: () => L('Блок-схема', 'Flowchart'),
    build() {
      const b = new Builder();
      const start = b.shape('round', -110, -420, 220, 70, L('Начало', 'Start'), G);
      const step = b.shape('rect', -110, -270, 220, 80, L('Действие', 'Process'), '#ffffff');
      const dec = b.shape('diamond', -140, -110, 280, 170, L('Условие?', 'Condition?'), Y);
      const yes = b.shape('rect', -110, 130, 220, 80, L('Если да', 'If yes'), '#ffffff');
      const no = b.shape('rect', 280, -65, 220, 80, L('Если нет', 'If no'), '#ffffff');
      const end = b.shape('round', -110, 290, 220, 70, L('Конец', 'End'), P);
      b.conn(start, step, 'b', 't');
      b.conn(step, dec, 'b', 't');
      b.conn(dec, yes, 'b', 't');
      b.conn(dec, no, 'r', 'l');
      b.conn(yes, end, 'b', 't');
      b.conn(no, end, 'b', 'r');
      b.text(20, 70, 60, L('Да', 'Yes'), 20, { bold: false });
      b.text(150, -105, 80, L('Нет', 'No'), 20, { bold: false });
      return b.objs;
    },
  },
  {
    id: 'brainstorm',
    name: () => L('Брейншторм', 'Brainstorm'),
    build() {
      const b = new Builder();
      b.text(-500, -430, 1000, L('Тема обсуждения', 'Topic to discuss'), 40, { align: 'center' });
      b.frame(-520, -340, 700, 640, L('Идеи', 'Ideas'), '#fffbea');
      b.frame(220, -340, 300, 640, L('Лучшие идеи', 'Top ideas'), '#ebfbee');
      const cols = [Y, O, P, V, BL, G];
      for (let i = 0; i < 6; i++) b.sticky(-480 + (i % 3) * 220, -280 + Math.floor(i / 3) * 220, L('Идея', 'Idea') + ' ' + (i + 1), cols[i], 170);
      return b.objs;
    },
  },
  {
    id: 'week',
    name: () => L('План недели', 'Weekly planner'),
    build() {
      const b = new Builder();
      const days = L(['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'], ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
      columns(b, days, ['#eef2ff', '#fff7e6', '#ebfbee', '#fff0f3', '#f3f0ff'],
        [[L('Планёрка', 'Standup')], [], [L('Созвон', 'Call')], [], [L('Итоги недели', 'Weekly review')]],
        { w: 340, h: 760, gap: 30, noteColor: [BL, O, G, P, V] });
      return b.objs;
    },
  },
];
