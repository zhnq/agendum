import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Button, Layout, Menu, Tooltip } from 'antd';
import {
  ApiOutlined,
  BellOutlined,
  HistoryOutlined,
  PlusOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { api } from './api';
import agendumMark from './assets/agendum-mark.svg';
import { useMediaQuery } from './useMediaQuery';
import type { Health } from './types';
import NlChatWidget from './components/NlChatWidget';
import TaskList from './pages/TaskList';
import TaskEdit from './pages/TaskEdit';
import TaskDetail from './pages/TaskDetail';
import Runs from './pages/Runs';
import RunDetailPage from './pages/RunDetail';
import Providers from './pages/Providers';
import Channels from './pages/Channels';
import Sources from './pages/Sources';
import Settings from './pages/Settings';

const { Sider, Content } = Layout;

function useMenuKey(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith('/runs')) return 'runs';
  if (pathname.startsWith('/providers')) return 'providers';
  if (pathname.startsWith('/channels')) return 'channels';
  if (pathname.startsWith('/sources')) return 'sources';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'tasks';
}

interface PageMeta {
  title: string;
  desc: string;
}

function pageMeta(pathname: string): PageMeta {
  if (pathname === '/tasks/new') return { title: '新建任务', desc: '配置 script 或 agent 任务' };
  if (/^\/tasks\/[^/]+\/edit$/.test(pathname)) return { title: '编辑任务', desc: '调整任务配置' };
  if (/^\/tasks\//.test(pathname)) return { title: '任务详情', desc: '配置摘要与运行记录' };
  if (pathname === '/runs') return { title: '运行历史', desc: '全部任务的运行记录' };
  if (/^\/runs\//.test(pathname)) return { title: '运行详情', desc: '单次运行的简报、轨迹与日志' };
  if (pathname.startsWith('/providers')) return { title: 'Provider', desc: '模型供应商与连通性' };
  if (pathname.startsWith('/channels')) return { title: '通知渠道', desc: '运行结果的送达方式' };
  if (pathname.startsWith('/sources')) return { title: '触发事件源', desc: '轮询外部变化、命中即触发任务' };
  if (pathname.startsWith('/settings')) return { title: '设置', desc: '应用启动与本机行为' };
  return { title: '任务', desc: '任务调度与运行状态' };
}

/** daemon 状态文案，宽屏卡片与窄屏色点共用 */
function healthText(health: Health | null, ok: boolean | null): { title: string; sub: string } {
  const title = ok === null ? '正在检测 daemon' : ok ? 'daemon 运行中' : 'daemon 已断开';
  const sub =
    ok && health
      ? `${health.runningCount} 个任务正在执行`
      : ok === false
        ? '无法连接 127.0.0.1:8787'
        : '…';
  return { title, sub };
}

function healthDotColor(ok: boolean | null): string {
  return ok === null ? 'var(--muted)' : ok ? 'var(--ok)' : 'var(--danger)';
}

function HealthCard({ health, ok }: { health: Health | null; ok: boolean | null }) {
  const { title, sub } = healthText(health, ok);
  return (
    <div
      style={{
        margin: 16,
        padding: '10px 12px',
        background: '#ffffff',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: healthDotColor(ok),
            flex: 'none',
          }}
        />
        {title}
      </div>
      <div style={{ marginTop: 2, paddingLeft: 16, color: 'var(--muted)', fontSize: 12 }}>
        {sub}
      </div>
    </div>
  );
}

export default function App() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const menuKey = useMenuKey();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const meta = pageMeta(pathname);
  const narrow = useMediaQuery('(max-width: 940px)');

  useEffect(() => {
    let alive = true;
    const check = () => {
      api
        .health()
        .then((h) => {
          if (!alive) return;
          setHealthy(h.ok);
          setHealth(h);
        })
        .catch(() => {
          if (!alive) return;
          setHealthy(false);
          setHealth(null);
        });
    };
    check();
    const timer = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const menuItems = [
    { key: 'tasks', icon: <UnorderedListOutlined />, label: <Link to="/">任务</Link> },
    { key: 'runs', icon: <HistoryOutlined />, label: <Link to="/runs">运行历史</Link> },
    { key: 'providers', icon: <ApiOutlined />, label: <Link to="/providers">Provider</Link> },
    { key: 'channels', icon: <BellOutlined />, label: <Link to="/channels">通知渠道</Link> },
    { key: 'sources', icon: <ThunderboltOutlined />, label: <Link to="/sources">触发事件源</Link> },
    { key: 'settings', icon: <SettingOutlined />, label: <Link to="/settings">设置</Link> },
  ];

  const { title: healthTitle, sub: healthSub } = healthText(health, healthy);

  const pageHeader = (
    <header
      style={{
        position: 'sticky',
        top: narrow ? 52 : 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        height: 64,
        padding: narrow ? '0 16px' : '0 28px',
        background: 'rgba(245, 247, 251, 0.88)',
        borderBottom: '1px solid var(--line)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{meta.title}</div>
        <div
          style={{
            color: 'var(--muted)',
            fontSize: 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {meta.desc}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {pathname === '/' && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tasks/new')}>
            新建任务
          </Button>
        )}
      </div>
    </header>
  );

  const routes = (
    <Routes>
      <Route path="/" element={<TaskList />} />
      <Route path="/tasks/new" element={<TaskEdit />} />
      <Route path="/tasks/:id/edit" element={<TaskEdit />} />
      <Route path="/tasks/:id" element={<TaskDetail />} />
      <Route path="/runs" element={<Runs />} />
      <Route path="/runs/:id" element={<RunDetailPage />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/channels" element={<Channels />} />
      <Route path="/sources" element={<Sources />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  // 窄屏：侧栏收为顶部条（品牌块 + 水平菜单 + daemon 状态点）
  if (narrow) {
    return (
      <Layout style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 52,
            padding: '0 12px',
            background: 'var(--side)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
            <div
              style={{
                width: 28,
                height: 28,
                flex: 'none',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <img
                src={agendumMark}
                alt="Agendum"
                style={{ display: 'block', width: '100%', height: '100%' }}
              />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1 }}>Agendum</span>
          </div>
          <Menu
            mode="horizontal"
            selectedKeys={[menuKey]}
            items={menuItems}
            style={{ flex: 1, minWidth: 0, background: 'transparent', borderBottom: 'none' }}
          />
          <Tooltip title={`${healthTitle} · ${healthSub}`}>
            <span
              aria-label={healthTitle}
              style={{
                width: 10,
                height: 10,
                flex: 'none',
                borderRadius: 999,
                background: healthDotColor(healthy),
              }}
            />
          </Tooltip>
        </div>
        {pageHeader}
        <Content style={{ padding: '16px 16px 48px', overflow: 'auto' }}>{routes}</Content>
        <NlChatWidget />
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        width={232}
        style={{
          background: 'var(--side)',
          borderRight: '1px solid var(--line)',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '22px 18px 18px',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                flex: 'none',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <img
                src={agendumMark}
                alt="Agendum"
                style={{ display: 'block', width: '100%', height: '100%' }}
              />
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1, letterSpacing: '-0.01em' }}>
              Agendum
            </div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[menuKey]}
            style={{ flex: 1, background: 'transparent', borderInlineEnd: 'none', padding: '0 8px' }}
            items={menuItems}
          />
          <HealthCard health={health} ok={healthy} />
        </div>
      </Sider>
      <Layout style={{ background: 'var(--bg)' }}>
        {pageHeader}
        <Content style={{ padding: '24px 28px 48px', overflow: 'auto' }}>{routes}</Content>
      </Layout>
      <NlChatWidget />
    </Layout>
  );
}
