import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { message, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import StatusTag from '../components/StatusTag';
import { durationText, fmtTime, triggerLabels } from '../labels';
import type { Run, Task } from '../types';

export default function Runs() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [taskNames, setTaskNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.listRuns(100), api.listTasks()])
      .then(([rs, ts]: [Run[], Task[]]) => {
        if (!alive) return;
        setRuns(rs);
        setTaskNames(new Map(ts.map((t) => [t.id, t.name])));
      })
      .catch((e: Error) => message.error(e.message))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const columns: ColumnsType<Run> = [
    { title: '运行 ID', dataIndex: 'id', width: 90 },
    {
      title: '任务',
      dataIndex: 'taskId',
      render: (taskId: number) => (
        <span style={{ fontWeight: 700 }}>{taskNames.get(taskId) ?? `任务 #${taskId}`}</span>
      ),
    },
    {
      title: '触发方式',
      dataIndex: 'trigger',
      width: 130,
      render: (tr: Run['trigger']) => <span className="mini-tag">{triggerLabels[tr]}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (st: Run['status']) => <StatusTag kind={st} />,
    },
    { title: '开始时间', dataIndex: 'startedAt', width: 180, render: (v: string) => fmtTime(v) },
    {
      title: '耗时',
      key: 'duration',
      width: 110,
      render: (_, r) => durationText(r.startedAt, r.finishedAt),
    },
    {
      title: '简报',
      key: 'summary',
      ellipsis: true,
      render: (_, r) => r.report?.summary ?? (r.error ? `错误：${r.error}` : '—'),
    },
  ];

  return (
    <div className="panel panel-table">
      <Table<Run>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={runs}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => navigate(`/runs/${r.id}`) })}
        locale={{ emptyText: '暂无运行记录' }}
      />
    </div>
  );
}
