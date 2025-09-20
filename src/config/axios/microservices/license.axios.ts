import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export class AxiosLicenseService {
    private readonly axiosInstance: AxiosInstance;

    constructor() {
        this.axiosInstance = axios.create({
            baseURL: `${process.env.GLOBAL_KODUS_SERVICE_BILLING}/api/billing/`,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    // Methods for encapsulating axios calls
    public async get(url: string, config = {}) {
        try {
            const { data } = await this.axiosInstance.get(url, config);
            return data;
        } catch (error) {
            console.log(error);
        }
    }

    public async post(
        url: string,
        body: Record<string, unknown> = {},
        config: AxiosRequestConfig = {}
    ): Promise<any> {
        const { data } = await this.axiosInstance.post(url, body, config);
        return data;
    }
}
