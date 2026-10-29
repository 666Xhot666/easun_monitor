import { inverterApi } from '@eam/shared/api';
import axios from './apiClient';

/** The shared API client, over the web app's axios (auth and refresh included). */
export const api = inverterApi(axios);
