/**
 * FAO WIEWS organisation lookup 
 * =============================
 *
 * Returns the details of one or more FAO WIEWS institute codes, as shown on
 * https://www.fao.org/wiews/data/organizations/en/?instcode=<INSTCODE>
 *
 * Usage:
 *   getWiewsOrganizations('MKD001,DEU146').then(function (results) {
 *     console.log(results)
 *   })
 *
 */
(function (root) {
  'use strict'

  var SEARCH_URL = 'https://wiews.fao.org/wiewsOrganizationsSearch'
  var LABELS_URL = 'https://storage.googleapis.com/fao-wiews-lang-bucket/frontendlabels_EN.json'
  var PAGE_URL = 'https://www.fao.org/wiews/data/organizations/en/?instcode='
  var REQUEST_TIMEOUT = 20000

  // Three letters (ISO 3166-1 alpha-3 country code) followed by three digits
  var INSTCODE_PATTERN = /^[A-Z]{3}[0-9]{3}$/

  // JSON fields basis
  var TABLE_LABELS = {
    name: 'Name of organization',
    acronym: 'Organization acronym',
    instcode: 'WIEWS instcode',
    parent_name: 'Parent organization',
    address: 'Address',
    zip_code: 'ZIP code',
    city: 'City',
    country: 'Country',
    telephone: 'Telephone',
    fax: 'Fax',
    email: 'Email address',
    website: 'WWW address',
    status: 'Organization authority status',
    longitude: 'Longitude (decimal degrees format)',
    latitude: 'Latitude (decimal degrees format)'
  }
  var ROLES_LABEL = 'Organization role categories'
  var ROLE_FIELD = /^role_f\d+$/

  // Role names basis
  var BUILT_IN_ROLE_NAMES = {
    role_f646: 'Genebank (long term collections)',
    role_f874: 'Genebank (medium term collections)',
    role_f875: 'Genebank (short term collections)',
    role_f647: 'Botanical garden',
    role_f648: 'Breeder',
    role_f649: 'Network',
    role_f650: 'Community',
    role_f651: 'Educational',
    role_f652: 'Seed producer',
    role_f653: 'Seed supplier',
    role_f654: 'Farmer community',
    role_f655: 'Research',
    role_f656: 'Extensionist',
    role_f657: 'Laboratory',
    role_f658: 'Publisher',
    role_f869: 'Administration/Policy'
  }

  // key names modifications
  function toKey (label) {
    return String(label)
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  }

  function failure (instcode, message) {
    return { success: false, instcode: instcode, error_message: message }
  }

  function fetchWithTimeout (url, options) {
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, REQUEST_TIMEOUT)
    var settings = Object.assign({}, options, { signal: controller.signal })

    return fetch(url, settings)
      .catch(function (error) {
        if (error && error.name === 'AbortError') {
          var timeout = new Error('the request timed out')
          timeout.name = 'TimeoutError'
          throw timeout
        }
        throw error
      })
      .finally(function () { clearTimeout(timer) })
  }

  // Role names
  var roleNamesPromise = null
  function getRoleNames () {
    if (!roleNamesPromise) {
      roleNamesPromise = fetchWithTimeout(LABELS_URL, { method: 'GET' })
        .then(function (response) { return response.ok ? response.json() : [] })
        .then(function (labels) {
          var names = Object.assign({}, BUILT_IN_ROLE_NAMES)
          ;(Array.isArray(labels) ? labels : []).forEach(function (label) {
            var match = label && /^organizations_details_(role_f\d+)$/.exec(label.frontend_label_id)
            if (match && label.frontend_label_en) {
              names[match[1]] = label.frontend_label_en
            }
          })
          return names
        })
        .catch(function () {
          roleNamesPromise = null
          return BUILT_IN_ROLE_NAMES
        })
    }

    return roleNamesPromise
  }

  function toResult (instcode, organisation, roleNames) {
    var result = { success: true, instcode: instcode }
    var roles = []

    Object.keys(organisation).forEach(function (field) {
      var value = organisation[field]

      if (ROLE_FIELD.test(field)) {
        if (value === true) {
          roles.push(roleNames[field] || field)
        }
        return
      }

      var key = TABLE_LABELS[field] ? toKey(TABLE_LABELS[field]) : toKey(field)
      result[key] = (typeof value === 'string' && value.trim() === '') ? null : value
    })

    result[toKey(ROLES_LABEL)] = roles
    return result
  }

  function lookUp (instcode) {
    return fetchWithTimeout(SEARCH_URL, {
      method: 'POST',
      // Same request as the WIEWS page sends; plain text keeps it a simple cross-origin request
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: JSON.stringify({ lang: 'en', size: 1, from: 0, filters: { instcode: instcode } })
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : ''))
        }
        return response.json().catch(function () {
          throw new Error('the service did not answer with valid JSON')
        })
      })
      .then(function (response) {
        var match = null

        if (response && Array.isArray(response.data)) {
          match = response.data.find(function (organisation) {
            return organisation && String(organisation.instcode).toUpperCase() === instcode
          }) || null
        }

        if (!match) {
          return failure(instcode, 'No organization found for institute code "' + instcode + '" (' + PAGE_URL + instcode + ' opens the search page instead).')
        }

        return getRoleNames().then(function (roleNames) {
          return toResult(instcode, match, roleNames)
        })
      })
      .catch(function (error) {
        // fetch rejects with a TypeError when there is no answer at all (offline, DNS, firewall, blocked request)
        var reason = error && error.message && error.name !== 'TypeError'
          ? error.message
          : 'no response from wiews.fao.org (network error or the request was blocked)'
        return failure(instcode, 'Request to FAO WIEWS failed for institute code "' + instcode + '": ' + reason + '.')
      })
  }

  /**
   * @param {string|string[]} instcodes One code, several codes separated by commas.
   * @returns {Promise<Object[]>} One result per code
   */
  function getWiewsOrganizations (instcodes) {
    var list = Array.isArray(instcodes)
      ? instcodes
      : String(instcodes === undefined || instcodes === null ? '' : instcodes).split(',')
    var codes = list
      .map(function (code) { return String(code).trim().toUpperCase() })
      .filter(function (code, index, all) { return code !== '' && all.indexOf(code) === index })

    if (codes.length === 0) {
      return Promise.resolve([failure(null, 'No institute code given. Example: getWiewsOrganizations("DEU146") or getWiewsOrganizations("MKD001,DEU146").')])
    }

    return Promise.all(codes.map(function (code) {
      if (!INSTCODE_PATTERN.test(code)) {
        return Promise.resolve(failure(code, 'Invalid institute code "' + code + '". A WIEWS institute code is the three-letter ISO 3166-1 alpha-3 country code followed by three digits, for example DEU146 (Germany) or MKD001 (North Macedonia).'))
      }
      return lookUp(code)
    }))
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getWiewsOrganizations: getWiewsOrganizations }
  } else {
    root.getWiewsOrganizations = getWiewsOrganizations
  }
})(typeof window !== 'undefined' ? window : this)
