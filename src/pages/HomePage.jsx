import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import WorldMap from '../components/WorldMap'
import LocationControls from '../components/LocationControls'
import SelectedLocation from '../components/SelectedLocation'
import { getCitiesForCountry } from '../data/citiesByCountry'
import {
  geoNameToDropdown,
  dropdownToGeoName,
} from '../data/countries'
import styles from './HomePage.module.css'

// ── Geocoding ─────────────────────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error('Geocoding failed')
  const data = await res.json()
  if (!data.length) throw new Error('Location not found')
  const item = data[0]
  return {
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  }
}

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error('Reverse geocoding failed')
  const data = await res.json()
  const city =
    data.address?.city ||
    data.address?.town ||
    data.address?.village ||
    data.address?.county ||
    ''
  const country = data.address?.country || ''
  return {
    displayName: [city, country].filter(Boolean).join(', '),
    dropdownCountry: geoNameToDropdown(country),
    lat,
    lng,
  }
}

// ── Component ─────────────────────────────────────────────────
export default function HomePage() {
  const navigate = useNavigate()

  // Dropdown state
  const [country, setCountry]       = useState('')   // dropdown value
  const [city, setCity]             = useState('')   // city dropdown value
  const [geoLoading, setGeoLoading] = useState(false)

  // Map selection state — stored as world-atlas geo.properties.name
  const [selectedGeoName, setSelectedGeoName] = useState(null)

  // Current resolved location for display + explore
  const [location, setLocation] = useState({ name: '', lat: null, lng: null })

  // Cities for current country
  const cities = getCitiesForCountry(country)

  // ── Helpers ────────────────────────────────────────────────
  async function resolveAndSetLocation(displayName, geocodeQuery) {
    setLocation({ name: displayName, lat: null, lng: null })
    try {
      const { lat, lng } = await geocode(geocodeQuery)
      setLocation({ name: displayName, lat, lng })
    } catch {
      // Keep name even if geocoding fails
    }
  }

  // ── Country dropdown ───────────────────────────────────────
  const handleCountryChange = useCallback(async (countryName) => {
    setCountry(countryName)
    setCity('')

    if (!countryName) {
      setLocation({ name: '', lat: null, lng: null })
      setSelectedGeoName(null)
      return
    }

    const geoName = dropdownToGeoName(countryName)
    setSelectedGeoName(geoName)
    await resolveAndSetLocation(countryName, countryName)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── City dropdown ──────────────────────────────────────────
  const handleCityChange = useCallback(async (cityName) => {
    setCity(cityName)
    if (!cityName) {
      // Revert to country-level location
      if (country) await resolveAndSetLocation(country, country)
      return
    }
    const displayName = country ? `${cityName}, ${country}` : cityName
    const geocodeQuery = country ? `${cityName}, ${country}` : cityName
    await resolveAndSetLocation(displayName, geocodeQuery)
  }, [country]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Geolocation button ─────────────────────────────────────
  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const result = await reverseGeocode(
            pos.coords.latitude,
            pos.coords.longitude,
          )
          setLocation({
            name: result.displayName,
            lat: result.lat,
            lng: result.lng,
          })
          if (result.dropdownCountry) {
            setCountry(result.dropdownCountry)
            setSelectedGeoName(dropdownToGeoName(result.dropdownCountry))
          }
          setCity('')
        } catch {
          setLocation({
            name: 'Current Location',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        } finally {
          setGeoLoading(false)
        }
      },
      () => setGeoLoading(false),
      { timeout: 10000 },
    )
  }, [])

  // ── Map click ──────────────────────────────────────────────
  const handleMapSelect = useCallback(async ({ geoName }) => {
    setSelectedGeoName(geoName)
    setCity('')

    // Automatically populate country dropdown with matching country name
    const dropdownName = geoNameToDropdown(geoName) || geoName
    setCountry(dropdownName)

    // Update selected location text and geocode coordinates
    await resolveAndSetLocation(dropdownName, geoName)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Explore ────────────────────────────────────────────────
  const handleExplore = useCallback(() => {
    navigate('/explore', {
      state: {
        name: location.name || city || country || 'Unknown',
        lat: location.lat,
        lng: location.lng,
      },
    })
  }, [navigate, location, city, country])

  const canExplore = !!(location.name || country || city)

  return (
    <main className={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header className={styles.header}>
        <h1 className={styles.title}>EarthBeat</h1>
        <p className={styles.tagline}>Don&apos;t just see Earth. Hear it.</p>
      </header>

      {/* ── Map ─────────────────────────────────────────────── */}
      <section className={styles.mapSection} aria-label="World map">
        <WorldMap
          selectedCountry={selectedGeoName}
          onSelect={handleMapSelect}
        />
      </section>

      {/* ── Controls ─────────────────────────────────────────── */}
      <section className={styles.controlsSection} aria-label="Location controls">
        <LocationControls
          country={country}
          city={city}
          cities={cities}
          onCountry={handleCountryChange}
          onCity={handleCityChange}
          onGeolocate={handleGeolocate}
          geoLoading={geoLoading}
        />
      </section>

      {/* ── Selected location ────────────────────────────────── */}
      <section className={styles.selectedSection} aria-label="Selected location">
        <SelectedLocation
          name={location.name}
          lat={location.lat}
          lng={location.lng}
        />
      </section>

      {/* ── Explore ──────────────────────────────────────────── */}
      <section className={styles.exploreSection}>
        <button
          className={styles.exploreBtn}
          onClick={handleExplore}
          disabled={!canExplore}
          aria-label="Explore selected location"
        >
          Explore
        </button>
      </section>
    </main>
  )
}
