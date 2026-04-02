export const PLATFORMS = [
  'direct', 'airbnb', 'greengo', 'abritel', 'abracadaroom', 'booking', 'gitedefrance', 'pitchup',
];

export const PLATFORM_COLORS = {
  direct: '#c9a227',
  airbnb: '#FF5A5F',
  greengo: '#4CAF50',
  abritel: '#1565c0',
  abracadaroom: '#00bcd4',
  booking: '#003580',
  gitedefrance: '#e6c832',
  pitchup: '#f57c00',
};

export function getPlatformColor(platform) {
  return PLATFORM_COLORS[platform] || '#757575';
}
