import ReactDOM from 'react-dom/client';
import App from './App';
import './global.css';

// 定义加载函数
const initApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Could not find root element to mount to');
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);

  // Cleanup on pagehide
  $(window).on('pagehide', () => {
    try {
      // 检查根元素是否仍然在 DOM 中
      if (rootElement && rootElement.isConnected) {
        root.unmount();
      }
    } catch (e) {
      // 静默处理卸载错误，避免与其他框架冲突
      console.warn('React unmount prevented:', e);
    }
  });

  // 处理来自内部 iframe 的跨域消息，支持展开/收起 iframe 尺寸（若本脚本作为酒馆注入脚本时执行）
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'mvu-expand') {
      const isExpanded = event.data.state;
      // 找到包含这个组件的 iframe
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of Array.from(iframes)) {
        if (iframe.contentWindow === event.source) {
          if (isExpanded) {
            // 设置为 fixed 全屏
            iframe.style.position = 'fixed';
            iframe.style.top = '0';
            iframe.style.left = '0';
            iframe.style.width = '100vw';
            iframe.style.height = '100vh';
            iframe.style.zIndex = '2147483600';
            iframe.style.border = 'none';
          } else {
            // 还原
            iframe.style.position = '';
            iframe.style.top = '';
            iframe.style.left = '';
            iframe.style.width = '100%';
            iframe.style.height = '150px'; // 或按需设为一个合适的高度
            iframe.style.zIndex = '';
          }
          break;
        }
      }
    }
  });
};

// 使用 jQuery 的 $(() => {}) 模式加载（酒馆环境）
if (typeof $ !== 'undefined') {
  $(() => {
    initApp();
  });
} else {
  // 备用：直接加载（开发测试环境）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}


