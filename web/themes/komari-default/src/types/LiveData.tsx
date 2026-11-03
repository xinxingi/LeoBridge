export type LiveData = {
    online: string[];
    data: { [key: string]: Record };
};

export type Record = {
  online?: boolean | null;
  bridge?: {stale: boolean; observed_at: number; stale_ms: number; transport: string};
  cpu: {
    usage: number;
  };
  ram: {
    total?: number;
    used: number;
  };
  swap: {
    used: number;
  };
  load: {
    load1: number;
    load5: number;
    load15: number;
  };
  disk: {
    total?: number;
    used: number;
  };
  network: {
    up: number;
    down: number;
    totalUp: number;
    totalDown: number;
  };
  connections: {
    tcp: number;
    udp: number;
  };
  gpu?: {
    count: number;
    average_usage: number;
    detailed_info: {
      name: string;
      memory_total: number;
      memory_used: number;
      utilization: number;
      temperature: number;
    }[];
  };
  uptime: number;
  process: number;
  message: string;
  updated_at: string;
};

export type LiveDataResponse = {
  data: LiveData;
  status: string;
};
