import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let isRefreshing = false;
let failedQueue: Array<{ resolve: Function; reject: Function }> = [];

function processQueue(error: any, token: string | null = null) {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
}

export const api: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send cookies
});

// ── Attach token ──
api.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auto refresh on 401 ──
api.interceptors.response.use(
  response => response,
  async (error: AxiosError) => {
    const original = error.config as any;
    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }
      original._retry = true;
      isRefreshing = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken }, { withCredentials: true });
        const { accessToken, refreshToken: newRT } = data;
        localStorage.setItem('accessToken', accessToken);
        if (newRT) localStorage.setItem('refreshToken', newRT);
        processQueue(null, accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (err) {
        processQueue(err, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

// ── Typed API calls ──
export const authApi = {
  login:      (data: { cedula: string; pin: string }) => api.post('/auth/login', data),
  verifyLogin2fa: (data: { cedula: string; otp: string }) => api.post('/auth/login/verify-2fa', data),
  register:   (data: any) => api.post('/auth/register', data),
  logout:     () => api.post('/auth/logout'),
  me:         () => api.get('/auth/me'),
  changePin:  (data: any) => api.put('/auth/change-pin', data),
  verifyPin:  (pin: string) => api.post('/auth/verify-pin', { pin }),
  sessions:            () => api.get('/auth/sessions'),
  revokeSession:       (id: string) => api.delete(`/auth/sessions/${id}`),
  revokeOtherSessions: () => api.post('/auth/sessions/revoke-others'),
};

export const usersApi = {
  updateProfile: (data: any) => api.put('/users/profile', data),
};

export const bankAccountsApi = {
  list:   () => api.get('/bank-accounts'),
  create: (data: any) => api.post('/bank-accounts', data),
  remove: (id: string) => api.delete(`/bank-accounts/${id}`),
};

export const walletApi = {
  balance:    () => api.get('/wallet/balance'),
  history:    (params?: any) => api.get('/wallet/history', { params }),
  send:       (data: any) => api.post('/wallet/enviar', data),
  qrGenerar:  (data: any) => api.post('/wallet/qr/generar', data),
  qrPersonal: () => api.get('/wallet/qr/personal'),
  qrPreview:  (token: string) => api.get(`/wallet/qr/${token}`),
  qrPagar:    (token: string, data?: any) => api.post(`/wallet/qr/${token}/pagar`, data || {}),
};

export const banksApi = {
  list: () => api.get('/banks'),
};

export const withdrawalsApi = {
  create:  (data: any) => api.post('/withdrawals', data),
  history: () => api.get('/withdrawals/me'),
};

export const rapydApi = {
  consignar: (monto: number) => api.post('/rapyd/consignar', { monto }),
  verificar: (reference: string) => api.get(`/rapyd/verificar/${reference}`),
};

export const notificationsApi = {
  list:    () => api.get('/users/notifications'),
  readAll: () => api.put('/users/notifications/read'),
  delete:  (id: string) => api.delete(`/users/notifications/${id}`),
  clear:   () => api.delete('/users/notifications'),
};

export const adminApi = {
  metrics:      () => api.get('/admin/metrics'),
  users:        (params?: any) => api.get('/admin/users', { params }),
  transactions: (params?: any) => api.get('/admin/transactions', { params }),
  chart:        (months: string) => api.get(`/admin/dashboard-chart?months=${months}`),
  updateUser:   (id: string, data: any) => api.put(`/admin/users/${id}`, data),
  deleteUser:   (id: string) => api.delete(`/admin/users/${id}`),
  pending:      () => api.get('/withdrawals/pending'),
  withdrawalsAll: () => api.get('/withdrawals'),
  approveWD:    (id: string) => api.put(`/withdrawals/${id}/approve`),
  rejectWD:     (id: string, motivo: string) => api.put(`/withdrawals/${id}/reject`, { motivo }),
  banks:        () => api.get('/admin/banks'),
  createBank:   (data: any) => api.post('/admin/banks', data),
  updateBank:   (id: string, data: any) => api.put(`/admin/banks/${id}`, data),
};
