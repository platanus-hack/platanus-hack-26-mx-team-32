// Loads the Mexico state boundaries GeoJSON and renders thick borders on a
// Google Map via the Data layer. The GeoJSON is fetched at runtime from
// /mexico_geo.json (copied into app/public/) so it doesn't bloat the bundle.

let cached: google.maps.Data | null = null

export function addMexicoBorders(map: google.maps.Map, theme: 'light' | 'dark' = 'light'): google.maps.Data | null {
  if (cached) {
    cached.setMap(map)
    cached.setStyle(styleFn(theme))
    return cached
  }

  const data = new google.maps.Data()
  data.setStyle(styleFn(theme))
  data.loadGeoJson('/mexico_geo.json', { idPropertyName: 'CVEGEO' }, () => {
    // loaded
  })
  data.setMap(map)
  cached = data
  return data
}

function styleFn(theme: 'light' | 'dark'): google.maps.Data.StyleOptions {
  return {
    strokeColor: theme === 'dark' ? '#F2921D' : '#B45309',
    strokeWeight: 2.5,
    strokeOpacity: 0.9,
    fillColor: 'transparent',
    fillOpacity: 0,
    clickable: false,
    visible: true,
  }
}
