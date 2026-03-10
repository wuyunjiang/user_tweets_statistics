import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      componentSize="small"
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#3dd9b3',
          colorBgBase: '#0a0f14',
          colorTextBase: '#edf2f7',
          borderRadius: 10,
          fontSize: 13,
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
