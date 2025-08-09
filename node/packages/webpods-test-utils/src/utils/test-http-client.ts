// Test HTTP client utilities
import axios, { AxiosInstance, AxiosResponse } from 'axios';

export class TestHttpClient {
  private client: AxiosInstance;
  private authToken: string | null = null;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      validateStatus: () => true, // Don't throw on any status code
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add auth interceptor
    this.client.interceptors.request.use((config) => {
      if (this.authToken) {
        config.headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      return config;
    });
  }

  public setAuthToken(token: string): void {
    this.authToken = token;
  }

  public clearAuthToken(): void {
    this.authToken = null;
  }

  public async get(url: string, params?: any): Promise<AxiosResponse> {
    return this.client.get(url, { params });
  }

  public async post(url: string, data?: any, headers?: any): Promise<AxiosResponse> {
    return this.client.post(url, data, { headers });
  }

  public async put(url: string, data?: any, headers?: any): Promise<AxiosResponse> {
    return this.client.put(url, data, { headers });
  }

  public async patch(url: string, data?: any, headers?: any): Promise<AxiosResponse> {
    return this.client.patch(url, data, { headers });
  }

  public async delete(url: string): Promise<AxiosResponse> {
    return this.client.delete(url);
  }

  public async head(url: string): Promise<AxiosResponse> {
    return this.client.head(url);
  }
}