import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'सुपर किराणा, निफाड', short_name: 'सुपर किराणा', lang: 'mr',
    description: 'बिल आणि उधारी खाते', start_url: '/home', scope: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: '#0f8043',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }],
  };
}
