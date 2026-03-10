import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  App as AntdApp,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Line, Pie } from '@ant-design/charts';
import dayjs, { Dayjs } from 'dayjs';
import { TWEET_TYPES, type QueryFormState, type ScrapeProgressEvent, type ScrapeStatus, type TweetRecord } from './types';
import { connectScrapeJob, fetchScrapeStatus, startScrapeJob } from './lib/api';
import { loadSnapshot, loadStoredQuery, saveSnapshot, saveStoredQuery } from './lib/storage';
import {
  buildSummary,
  buildTimelineData,
  buildTimelineSeriesData,
  buildTypeChartData,
  mapTweets,
} from './lib/tweets';

const { Paragraph, Text, Title } = Typography;

const defaultStartDate = dayjs().subtract(6, 'day').second(0);
const lineSeriesOptions = ['总量', ...TWEET_TYPES];
const lineColorMap = {
  总量: '#ffffff',
  转推推文: '#42d6a4',
  引用推文: '#ffd166',
  投票推文: '#6ea8fe',
  纯文本发帖: '#ff7b72',
  多媒体发帖: '#b388ff',
  链接推文: '#7ae7ff',
  空间分享推文: '#ffa94d',
  '推文串/连推 (Threads)': '#f06595',
  文章: '#7bd389',
  其他: '#adb5bd',
} as const;
const pieColorDomain = TWEET_TYPES.map((type) => type);
const pieColorRange = pieColorDomain.map((type) => lineColorMap[type]);

const columns: ColumnsType<TweetRecord> = [
  {
    title: '推文类型',
    dataIndex: 'type',
    width: 150,
    render: (value: string) => <Tag color="cyan">{value}</Tag>,
  },
  {
    title: '时间',
    dataIndex: 'createdLabel',
    width: 170,
  },
  {
    title: '内容',
    dataIndex: 'url',
    ellipsis: false,
    render: (_value: string | null, record) =>
      record.url ? (
        <a href={record.url} target="_blank" rel="noreferrer" className="tweet-link" title={record.url}>
          {record.text || record.url}
        </a>
      ) : (
        record.text || '-'
      ),
  },
  {
    title: 'Comment',
    dataIndex: 'commentCount',
    width: 100,
  },
  {
    title: 'RT',
    dataIndex: 'rtCount',
    width: 90,
  },
  {
    title: 'Like',
    dataIndex: 'likeCount',
    width: 90,
  },
];

function toFormValues(query: QueryFormState | null) {
  if (!query) {
    return {
      username: '',
      startDate: defaultStartDate,
    };
  }

  return {
    username: query.username,
    startDate: query.startDate ? dayjs(query.startDate) : defaultStartDate,
  };
}

export default function App() {
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();
  const storedQuery = loadStoredQuery();
  const storedSnapshot = loadSnapshot();
  const [records, setRecords] = useState<TweetRecord[]>(storedSnapshot?.records ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(storedSnapshot?.savedAt ?? null);
  const [status, setStatus] = useState<ScrapeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScrapeProgressEvent | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [timelineGranularity, setTimelineGranularity] = useState<'4h' | 'day' | 'week' | 'month'>('day');
  const [visibleLineTypes, setVisibleLineTypes] = useState<string[]>(lineSeriesOptions);
  const [pageSize, setPageSize] = useState(20);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    form.setFieldsValue(toFormValues(storedQuery ?? storedSnapshot?.query ?? null));
  }, [form, storedQuery, storedSnapshot]);

  useEffect(
    () => () => {
      socketRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        const nextStatus = await fetchScrapeStatus();
        setStatus(nextStatus);
      } catch (statusFetchError) {
        setStatusError(statusFetchError instanceof Error ? statusFetchError.message : '状态读取失败');
      }
    })();
  }, []);

  const filteredRecords = useMemo(
    () => (selectedTypes.length ? records.filter((record) => selectedTypes.includes(record.type)) : records),
    [records, selectedTypes],
  );
  const summary = useMemo(() => buildSummary(filteredRecords), [filteredRecords]);
  const typeChartData = useMemo(() => buildTypeChartData(filteredRecords), [filteredRecords]);
  const timelineData = useMemo(() => buildTimelineData(filteredRecords, timelineGranularity), [filteredRecords, timelineGranularity]);
  const timelineSeriesData = useMemo(
    () => buildTimelineSeriesData(filteredRecords, timelineGranularity).filter((item) => visibleLineTypes.includes(item.type)),
    [filteredRecords, timelineGranularity, visibleLineTypes],
  );
  const lineColorDomain = useMemo(
    () => lineSeriesOptions.filter((type) => visibleLineTypes.includes(type)),
    [visibleLineTypes],
  );
  const lineColorRange = useMemo(
    () => lineColorDomain.map((type) => lineColorMap[type as keyof typeof lineColorMap] ?? '#7ae7ff'),
    [lineColorDomain],
  );
  const progressPercent = useMemo(() => {
    if (!progress?.checkpointCreatedAt || !form.getFieldValue('startDate')) {
      return progress?.phase === 'done' ? 100 : 0;
    }
    const start = dayjs(form.getFieldValue('startDate') as Dayjs);
    const newest = progress.newestCreatedAt ? dayjs(progress.newestCreatedAt) : dayjs();
    const oldest = dayjs(progress.checkpointCreatedAt);
    const totalRange = Math.max(newest.valueOf() - start.valueOf(), 1);
    const covered = Math.min(Math.max(newest.valueOf() - oldest.valueOf(), 0), totalRange);
    return progress.phase === 'done' ? 100 : Math.max(1, Math.min(99, Math.round((covered / totalRange) * 100)));
  }, [form, progress]);

  async function handleSubmit(values: { username: string; startDate: Dayjs }) {
    const start = values.startDate;
    const query: QueryFormState = {
      username: values.username,
      startDate: start.format('YYYY-MM-DD HH:mm:ss'),
    };

    saveStoredQuery(query);
    setLoading(true);
    setError(null);
    setProgress(null);
    socketRef.current?.close();

    try {
      const { jobId } = await startScrapeJob({
        username: query.username,
        startDate: start.format('YYYY-MM-DD HH:mm:ss'),
      });

      socketRef.current = connectScrapeJob(jobId, {
        onMessage: (event) => {
          setProgress(event);
          const mapped = mapTweets(event.records ?? []);
          setRecords(mapped);

          if (event.phase === 'done') {
            const snapshot = {
              query,
              records: mapped,
              savedAt: new Date().toISOString(),
            };
            saveSnapshot(snapshot);
            setSavedAt(snapshot.savedAt);
            setLoading(false);
            message.success(`已获取 ${mapped.length} 条推文`);
            socketRef.current?.close();
            socketRef.current = null;
          }

          if (event.phase === 'error') {
            setLoading(false);
            setError(event.error ?? event.message ?? '抓取失败');
            socketRef.current?.close();
            socketRef.current = null;
          }
        },
        onError: () => {
          setLoading(false);
          setError('WebSocket 连接失败，无法接收实时进度');
        },
      });
    } catch (submitError) {
      const nextError = submitError instanceof Error ? submitError.message : '请求失败';
      setError(nextError);
      setLoading(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-background" />
      <div className="page-content">
        <Card className="hero-card">
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Text className="eyebrow">OpenTwitter MCP Dashboard</Text>
            <Title level={2} style={{ margin: 0 }}>
              推文统计面板
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              本地 Playwright 服务会复用登录态打开 X，自动滚动目标用户主页抓取推文，一直抓到起始日期为止。数据会保存在浏览器本地存储。
            </Paragraph>
          </Space>
        </Card>

        {status ? (
          <Alert
            type={status.loggedIn ? 'success' : 'warning'}
            showIcon
            className="error-banner"
            message={status.loggedIn ? 'Playwright 服务已登录 X 账号' : 'Playwright 服务已启动，请先在弹出的浏览器中登录 X'}
            description={`浏览器目录：${status.profilePath}`}
          />
        ) : null}

        {statusError ? (
          <Alert
            type="error"
            showIcon
            className="error-banner"
            message="本地服务不可用"
            description="请先运行 `npm run server` 或 `npm run dev:full`，再刷新当前页面。"
          />
        ) : null}

        <Card className="panel-card">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={toFormValues(storedQuery ?? storedSnapshot?.query ?? null)}
          >
            <Row gutter={[12, 12]}>
              <Col xs={24} md={10}>
                <Form.Item
                  label="推特用户名"
                  name="username"
                  rules={[{ required: true, message: '请输入推特用户名' }]}
                >
                  <Input placeholder="@elonmusk" allowClear />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  label="向前翻到这个时间点"
                  name="startDate"
                  rules={[{ required: true, message: '请选择时间点' }]}
                >
                  <DatePicker
                    style={{ width: '100%' }}
                    allowClear={false}
                    showTime={{ format: 'HH:mm:ss' }}
                    format="YYYY-MM-DD HH:mm:ss"
                  />
                </Form.Item>
              </Col>
            </Row>

            <Space wrap>
              <Button type="primary" htmlType="submit" loading={loading}>
                开始统计
              </Button>
              {savedAt ? <Text type="secondary">最近缓存：{dayjs(savedAt).format('YYYY-MM-DD HH:mm:ss')}</Text> : null}
            </Space>
          </Form>
        </Card>

        {progress ? (
          <Card className="panel-card" title="实时进度">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Progress percent={progressPercent} status={progress.phase === 'error' ? 'exception' : undefined} />
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Statistic title="接口响应次数" value={progress.responseCount} />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic title="已收集推文" value={progress.collectedCount} />
                </Col>
                <Col xs={24} md={6}>
                  <Statistic
                    title="当前请求页时间点"
                    value={progress.checkpointCreatedAt ? dayjs(progress.checkpointCreatedAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
                  />
                </Col>
                <Col xs={24} md={6}>
                  <Statistic title="当前最新时间" value={progress.newestCreatedAt ? dayjs(progress.newestCreatedAt).format('YYYY-MM-DD HH:mm:ss') : '-'} />
                </Col>
              </Row>
              {progress.message ? <Text type="secondary">{progress.message}</Text> : null}
            </Space>
          </Card>
        ) : null}

        {error ? (
          <Alert
            type="error"
            showIcon
            message="请求失败"
            description={error}
            className="error-banner"
          />
        ) : null}

        <Row gutter={[12, 12]}>
          <Col xs={12} md={6}>
            <Card className="metric-card">
              <Statistic title="推文总数" value={summary.totalTweets} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card className="metric-card">
              <Statistic title="评论总数" value={summary.totalComments} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card className="metric-card">
              <Statistic title="转推总数" value={summary.totalRetweets} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card className="metric-card">
              <Statistic title="点赞总数" value={summary.totalLikes} />
            </Card>
          </Col>
        </Row>

        <Card title="推文明细" className="panel-card">
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={14}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Text type="secondary">推文类型筛选</Text>
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择要查看的推文类型"
                  style={{ width: '100%' }}
                  value={selectedTypes}
                  onChange={(value) => setSelectedTypes(value)}
                  options={TWEET_TYPES.map((type) => ({ label: type, value: type }))}
                />
              </Space>
            </Col>
            <Col xs={24} md={10}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Text type="secondary">每页条数</Text>
                <Segmented
                  block
                  value={pageSize}
                  onChange={(value) => setPageSize(Number(value))}
                  options={[
                    { label: '10 条', value: 10 },
                    { label: '20 条', value: 20 },
                    { label: '50 条', value: 50 },
                    { label: '100 条', value: 100 },
                  ]}
                />
              </Space>
            </Col>
          </Row>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filteredRecords}
            pagination={{ pageSize, showSizeChanger: false }}
            scroll={{ x: 900 }}
            size="small"
          />
        </Card>

        <Row gutter={[12, 12]}>
          <Col xs={24} lg={8}>
            <Card title="推文类型分布" className="panel-card chart-card">
              <Pie
                data={typeChartData}
                angleField="count"
                colorField="type"
                scale={{ color: { domain: pieColorDomain, range: pieColorRange } }}
                legend={{ color: { position: 'bottom', itemLabelFill: '#ecfff8' } }}
                style={{ stroke: '#06131a', lineWidth: 1 }}
                tooltip={{ items: [{ channel: 'y', name: '数量' }] }}
                labels={[]}
                height={280}
              />
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card title="推文趋势" className="panel-card chart-card">
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Row gutter={[12, 12]}>
                  <Col xs={24} md={10}>
                    <Segmented
                      block
                      value={timelineGranularity}
                      onChange={(value) => setTimelineGranularity(value as '4h' | 'day' | 'week' | 'month')}
                      options={[
                        { label: '每 4 小时', value: '4h' },
                        { label: '每天', value: 'day' },
                        { label: '每周', value: 'week' },
                        { label: '每月', value: 'month' },
                      ]}
                    />
                  </Col>
                  <Col xs={24} md={14}>
                    <Select
                      mode="multiple"
                      style={{ width: '100%' }}
                      value={visibleLineTypes}
                      onChange={(value) => setVisibleLineTypes(value)}
                      options={lineSeriesOptions.map((type) => ({ label: type, value: type }))}
                      placeholder="选择折线图中显示的推文类型"
                    />
                  </Col>
                </Row>
                <Line
                  data={timelineSeriesData}
                  xField="date"
                  yField="count"
                  seriesField="type"
                  colorField="type"
                  scale={{ color: { domain: lineColorDomain, range: lineColorRange } }}
                  axis={{
                    x: { labelFill: '#d7f7ef', labelFontSize: 11 },
                    y: { labelFill: '#d7f7ef', gridStroke: 'rgba(215,247,239,0.12)' },
                  }}
                  legend={{ color: { position: 'top', itemLabelFill: '#ecfff8' } }}
                  point={{ shapeField: 'circle', sizeField: 3, style: { stroke: '#06131a', lineWidth: 1 } }}
                  style={({ type }: { type: string }) => ({
                    lineWidth: type === '总量' ? 3.2 : 2.2,
                    opacity: type === '总量' ? 1 : 0.9,
                  })}
                  smooth
                  height={280}
                />
                <Text type="secondary">总量参考：{timelineData.map((item) => `${item.date}(${item.count})`).slice(0, 6).join(' / ')}</Text>
              </Space>
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  );
}
