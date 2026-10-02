/**
 * 前端全局运行时配置
 * 统一管理系统路径与可自定义选项
 */

/**
 * 管理后台入口路径
 * 默认从环境变量 VITE_ADMIN_PATH 中读取，支持自由自定义（防公网扫描爆破）
 * 若未设置，将使用构建时自动生成的随机安全路径或安全回退值
 */
const rawAdminPath = (import.meta.env.VITE_ADMIN_PATH as string) || '/adm_secret';

// 规范化路径：确保以斜杠开头，且不以尾部斜杠结尾
export const ADMIN_PATH: string = '/' + rawAdminPath.replace(/^\/+|\/+$/g, '');
