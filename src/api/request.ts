import { API_BASE_URL } from "@/config/api";
import { readMiniappSession } from "@/storage/miniapp-session";
import type { ApiErrorOptions } from "@/types/api";

export class ApiError extends Error {
  readonly statusCode?: number;
  readonly cause?: unknown;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = options.statusCode;
    this.cause = options.cause;
  }
}

interface RequestOptions<TData> {
  path: string;
  method?: "GET" | "POST";
  data?: TData;
  requiresMiniappAuth?: boolean;
}

export function request<TResponse, TData = Record<string, never>>(
  options: RequestOptions<TData>,
): Promise<TResponse> {
  const normalizedPath = `/${options.path.replace(/^\/+/, "")}`;
  const token = options.requiresMiniappAuth ? readMiniappSession()?.sessionToken : null;
  if (options.requiresMiniappAuth && !token) {
    return Promise.reject(new ApiError("MINIAPP_AUTH_REQUIRED"));
  }
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}${normalizedPath}`,
      method: options.method ?? "GET",
      timeout: 10000,
      header: token ? { Authorization: `Bearer ${token}` } : undefined,
      data: options.data as UniNamespace.RequestOptions["data"],
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as TResponse);
          return;
        }
        const errorBody = response.data as { message?: unknown; error?: unknown } | undefined;
        const serverMessage = errorBody?.message;
        const serverError = errorBody?.error;
        const message = typeof serverMessage === "string" && serverMessage.trim()
          ? serverMessage
          : typeof serverError === "string" && serverError.trim()
            ? serverError
          : `请求失败（HTTP ${response.statusCode}）`;
        reject(new ApiError(message, { statusCode: response.statusCode }));
      },
      fail(error) {
        reject(new ApiError(`网络请求失败：${error.errMsg || "请检查网络连接"}`, { cause: error }));
      },
    });
  });
}
