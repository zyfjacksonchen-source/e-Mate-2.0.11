import '@arco-design/web-react/dist/css/arco.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const savedTheme = () => {
  try {
    const value = localStorage.getItem('e-mate.usage.theme');
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
};
const applySystemTheme = ({ matches }: Pick<MediaQueryList, 'matches'>) => {
  const theme = savedTheme() ?? (matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.body.setAttribute('arco-theme', theme);
};

applySystemTheme(systemTheme);
systemTheme.addEventListener('change', applySystemTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
