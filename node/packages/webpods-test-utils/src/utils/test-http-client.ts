// Test HTTP client utilities using native fetch

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  data: any;
  text?: string;
}

export class TestHttpClient {
  private baseURL: string;
  private authToken: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  public setAuthToken(token: string): void {
    this.authToken = token;
  }

  public clearAuthToken(): void {
    this.authToken = null;
  }

  public setBaseUrl(baseURL: string): void {
    this.baseURL = baseURL;
  }

  private buildUrl(path: string, params?: any): string {
    const url = new URL(path, this.baseURL);
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined) {
          url.searchParams.append(key, params[key]);
        }
      });
    }
    return url.toString();
  }

  private getHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...additionalHeaders
    };
    
    if (this.authToken) {
      headers['Authorization'] = this.authToken.startsWith('Bearer ') 
        ? this.authToken 
        : `Bearer ${this.authToken}`;
    }
    
    return headers;
  }

  private async processResponse(response: Response): Promise<FetchResponse> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const text = await response.text();
    let data: any = text;
    
    // Try to parse as JSON if content-type suggests it
    const contentType = headers['content-type'] || '';
    if (contentType.includes('application/json') && text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Keep as text if JSON parsing fails
      }
    }

    return {
      status: response.status,
      headers,
      data,
      text
    };
  }

  public async get(url: string, config?: any): Promise<FetchResponse> {
    const options: RequestInit = {
      method: 'GET',
      headers: this.getHeaders(config?.headers)
    };

    // Handle followRedirect option
    if (config?.followRedirect === false) {
      options.redirect = 'manual';
    }

    // Build URL with params
    const fullUrl = this.buildUrl(url, config?.params);
    
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async post(url: string, data?: any, config?: any): Promise<FetchResponse> {
    const headers = this.getHeaders(config?.headers);
    
    let body: string | undefined;
    if (data !== undefined) {
      if (typeof data === 'string') {
        body = data;
        // Override content-type for plain text
        if (!config?.headers?.['Content-Type'] && !config?.headers?.['content-type']) {
          headers['Content-Type'] = 'text/plain';
        }
      } else {
        body = JSON.stringify(data);
      }
    }

    const options: RequestInit = {
      method: 'POST',
      headers,
      body
    };

    // Handle followRedirect option
    if (config?.followRedirect === false) {
      options.redirect = 'manual';
    }

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async put(url: string, data?: any, config?: any): Promise<FetchResponse> {
    const headers = this.getHeaders(config?.headers);
    
    let body: string | undefined;
    if (data !== undefined) {
      if (typeof data === 'string') {
        body = data;
        // Override content-type for plain text
        if (!config?.headers?.['Content-Type'] && !config?.headers?.['content-type']) {
          headers['Content-Type'] = 'text/plain';
        }
      } else {
        body = JSON.stringify(data);
      }
    }

    const options: RequestInit = {
      method: 'PUT',
      headers,
      body
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async patch(url: string, data?: any, config?: any): Promise<FetchResponse> {
    const headers = this.getHeaders(config?.headers);
    
    let body: string | undefined;
    if (data !== undefined) {
      if (typeof data === 'string') {
        body = data;
        // Override content-type for plain text
        if (!config?.headers?.['Content-Type'] && !config?.headers?.['content-type']) {
          headers['Content-Type'] = 'text/plain';
        }
      } else {
        body = JSON.stringify(data);
      }
    }

    const options: RequestInit = {
      method: 'PATCH',
      headers,
      body
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async delete(url: string): Promise<FetchResponse> {
    const options: RequestInit = {
      method: 'DELETE',
      headers: this.getHeaders()
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async head(url: string): Promise<FetchResponse> {
    const options: RequestInit = {
      method: 'HEAD',
      headers: this.getHeaders()
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }
}