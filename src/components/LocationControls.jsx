import { useMemo } from 'react'
import { COUNTRIES } from '../data/countries'
import styles from './LocationControls.module.css'

export { COUNTRIES }

/**
 * LocationControls — Country select, City select (driven by country), and geolocation button.
 *
 * Props:
 *   country      {string}    Current country name (dropdown value)
 *   city         {string}    Current city name (dropdown value)
 *   cities       {string[]}  City list for current country (populated by parent)
 *   onCountry    {fn}        Called with country name string
 *   onCity       {fn}        Called with city name string
 *   onGeolocate  {fn}        Called when user requests geolocation
 *   geoLoading   {bool}      True while geolocation is pending
 */
export default function LocationControls({
  country,
  city,
  cities = [],
  onCountry,
  onCity,
  onGeolocate,
  geoLoading,
}) {
  const hasCities = cities.length > 0

  // Ensure any selected country (from map or geolocation) is always an option in the select
  const countryOptions = useMemo(() => {
    if (country && !COUNTRIES.includes(country)) {
      return [country, ...COUNTRIES].sort((a, b) => a.localeCompare(b))
    }
    return COUNTRIES
  }, [country])

  return (
    <div className={styles.controls}>
      {/* Country */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="country-select">
          Country
        </label>
        <select
          id="country-select"
          className={styles.select}
          value={country}
          onChange={(e) => onCountry(e.target.value)}
        >
          <option value="">— Select —</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* City */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="city-select">
          City
        </label>
        <select
          id="city-select"
          className={styles.select}
          value={city}
          onChange={(e) => onCity(e.target.value)}
          disabled={!hasCities}
          aria-disabled={!hasCities}
        >
          <option value="">
            {country
              ? hasCities
                ? '— Select city —'
                : '— No cities listed —'
              : '— Select a country first —'}
          </option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Geolocation */}
      <div className={styles.field}>
        <span className={styles.label} aria-hidden="true">
          My Location
        </span>
        <button
          className={styles.geoButton}
          onClick={onGeolocate}
          disabled={geoLoading}
          aria-label="Use my current location"
        >
          {geoLoading ? 'Locating…' : 'Use My Location'}
        </button>
      </div>
    </div>
  )
}
