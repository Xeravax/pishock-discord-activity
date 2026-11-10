import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { DemoApp } from './DemoApp';
import { AppVersionBadge } from './components/AppVersionBadge';
// Official PiShock / Quasar stylesheet (font URLs rewritten to pishock.com)
import './vendor/pishock/app.cdn.css';
import './vendor/pishock/chunk-common.css';
import './vendor/pishock/control.css';
import './vendor/pishock/mdi.css';
import './styles.css';

const demo =
  new URLSearchParams(window.location.search).has('demo') ||
  window.location.hash === '#/demo';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <>
      {demo ? <DemoApp /> : <App />}
      <AppVersionBadge />
    </>
  </React.StrictMode>,
);
