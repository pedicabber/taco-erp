import axios from "axios";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export const apiClient = axios.create({
  baseURL: `${BASE_URL}/api`,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

export function getApiUrl(path: string): string {
  return `${BASE_URL}/api${path}`;
}
