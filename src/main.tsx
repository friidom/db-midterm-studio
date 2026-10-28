import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { configureSql } from './lib/sql';
import App from './App';
import './styles.css';

configureSql(() => wasmUrl);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
