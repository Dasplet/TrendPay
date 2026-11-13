import axios from 'axios';
import { getConfigTransferencias, KushkiError } from './kushki';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

describe('Configuración de consignaciones por transferencia (Kushki Transfer In)', () => {
  it('consulta con paymentType=PAYMENT y la llave pública, e interpreta PSE y Bre-B', async () => {
    http.get.mockResolvedValue({ data: { processors: [
      { name: 'Pse Processor', currency: 'COP' },
      { name: 'Bre-B Processor', currency: 'COP', supportedFlows: [{ paymentType: 'PAYMENT', channels: ['QR'] }] },
    ] } });
    const r = await getConfigTransferencias();
    const [url, opciones] = http.get.mock.calls[0] as [string, { params: unknown; headers: Record<string, string> }];
    expect(url).toMatch(/\/transfer\/v1\/config$/);
    expect(opciones.params).toEqual({ paymentType: 'PAYMENT' });
    expect(Object.keys(opciones.headers)).toEqual(['Public-Merchant-Id']);
    expect(r.procesadores).toEqual([
      { name: 'Pse Processor', currency: 'COP', tipo: 'pse', canales: [] },
      { name: 'Bre-B Processor', currency: 'COP', tipo: 'bre-b', canales: ['QR'] },
    ]);
  });

  it('sin procesadores configurados devuelve lista vacía', async () => {
    http.get.mockResolvedValue({ data: { processors: [] } });
    expect((await getConfigTransferencias()).procesadores).toEqual([]);
  });

  it('un error de Kushki se convierte en KushkiError con el estado y la respuesta', async () => {
    http.get.mockRejectedValue({ message: 'x', response: { status: 401, data: { message: 'Unauthorized' } } });
    await expect(getConfigTransferencias()).rejects.toMatchObject({ status: 401, message: 'Unauthorized', respuesta: { message: 'Unauthorized' } });
    await expect(getConfigTransferencias()).rejects.toBeInstanceOf(KushkiError);
  });
});
