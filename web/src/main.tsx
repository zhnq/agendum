import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorPrimaryHover: '#1d4ed8',
          colorSuccess: '#1f8a4c',
          colorError: '#c63f36',
          colorWarning: '#b7791f',
          colorInfo: '#0d8ca3',
          colorText: '#1b2434',
          colorTextSecondary: '#5d6b81',
          colorBorder: '#dde3ee',
          colorBorderSecondary: '#dde3ee',
          colorSplit: '#dde3ee',
          colorBgLayout: '#f5f7fb',
          borderRadius: 8,
          borderRadiusLG: 12,
          fontFamily:
            'MiSans, "MiSans VF", "PingFang SC", "Microsoft YaHei", system-ui, "Segoe UI", sans-serif',
          fontWeightStrong: 700,
        },
        components: {
          Table: {
            headerBg: '#f9fafd',
          },
          Menu: {
            itemSelectedBg: '#dce8fd',
            itemSelectedColor: '#2563eb',
            itemBorderRadius: 8,
            activeBarBorderWidth: 0,
          },
          Layout: {
            siderBg: '#f9fafd',
          },
        },
      }}
    >
      <HashRouter>
        <App />
      </HashRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
