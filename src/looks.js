import { getLang } from './i18n.js';

const L = (ru, en) => (getLang() === 'ru' ? ru : en);

// Готовые цветовые схемы доски: фон, цвет линий (точек, сетки, клеток) и при желании стиль фона
export const LOOKS = [
  { id: 'default', name: () => L('Стандарт', 'Default'), bg: null, line: null },
  { id: 'paper', name: () => L('Бумага', 'Paper'), bg: '#fbf5e6', line: '#c2b08a' },
  { id: 'mint', name: () => L('Мята', 'Mint'), bg: '#eaf6ef', line: '#86b79d' },
  { id: 'sky', name: () => L('Небо', 'Sky'), bg: '#e8f1fb', line: '#86a9d6' },
  { id: 'rose', name: () => L('Роза', 'Rose'), bg: '#fdeef2', line: '#dc9db1' },
  { id: 'chalk', name: () => L('Грифельная', 'Chalkboard'), bg: '#2f4a3f', line: '#8fb09f' },
  { id: 'graphite', name: () => L('Графит', 'Graphite'), bg: '#2b2f36', line: '#6b7280' },
  { id: 'night', name: () => L('Ночь', 'Night'), bg: '#0f1424', line: '#3a4770' },
  { id: 'blueprint', name: () => L('Чертёж', 'Blueprint'), bg: '#16408f', line: '#6f9be0', style: 'grid' },
];

// Нейтральные цвета пера и текста по умолчанию: тёмный на светлом фоне, светлый на тёмном
export const INK_ON_LIGHT = '#1a1a1a';
export const INK_ON_DARK = '#f1f3f5';

// Тёмный ли цвет (по относительной яркости sRGB)
export function isDarkColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return false;
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const y = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return y < 0.2;
}
