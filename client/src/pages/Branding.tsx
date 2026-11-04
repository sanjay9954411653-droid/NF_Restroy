/**
 * Branding — Admin page to edit the restaurant's public-facing branding:
 * logo, hero image, tagline/description, contact info, social links,
 * theme colors/font, and whether the public website is published.
 *
 * Logo and cover photo can be uploaded (when Cloudinary is set up in
 * config/imageUpload.ts) or pasted as an https link.
 */

import ImageField from '../components/ImageField'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api, { getErrorMessage } from '../api'
import Card from '../components/Card'
import Button from '../components/Button'
import Loading from '../components/Loading'
import {
  PhotoIcon,
  GlobeAltIcon,
  SwatchIcon,
} from '@heroicons/react/24/outline'

interface RestaurantProfile {
  id: string
  name: string
  slug: string
  logo_url: string | null
  hero_image_url: string | null
  tagline: string | null
  description: string | null
  address: string | null
  phone: string | null
  whatsapp: string | null
  public_email: string | null
  social_links: Record<string, string>
  website_published: boolean
}

interface Theme {
  primary_color: string
  secondary_color: string
  accent_color: string
  background_color: string
  text_color: string
  font_family: string
}

const FONT_OPTIONS = ['Inter', 'Poppins', 'Roboto', 'Lato', 'Montserrat', 'Playfair Display']

const emptyProfileFields = {
  name: '',
  logo_url: '',
  hero_image_url: '',
  tagline: '',
  description: '',
  address: '',
  phone: '',
  whatsapp: '',
  public_email: '',
  facebook: '',
  instagram: '',
  twitter: '',
  google_review: '',
  youtube: '',
  website_published: false,
}

const Branding: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingTheme, setSavingTheme] = useState(false)

  const [fields, setFields] = useState(emptyProfileFields)
  const [theme, setTheme] = useState<Theme>({
    primary_color: '#111827',
    secondary_color: '#f59e0b',
    accent_color: '#10b981',
    background_color: '#ffffff',
    text_color: '#111827',
    font_family: 'Inter',
  })

  useEffect(() => {
    Promise.all([
      api.get<{ success: boolean; data: RestaurantProfile }>('/restaurants/me'),
      api.get<{ success: boolean; data: Theme }>('/restaurants/me/theme'),
    ])
      .then(([profileRes, themeRes]) => {
        const p = profileRes.data.data
        setFields({
          name: p.name || '',
          logo_url: p.logo_url || '',
          hero_image_url: p.hero_image_url || '',
          tagline: p.tagline || '',
          description: p.description || '',
          address: p.address || '',
          phone: p.phone || '',
          whatsapp: p.whatsapp || '',
          public_email: p.public_email || '',
          facebook: p.social_links?.facebook || '',
          instagram: p.social_links?.instagram || '',
          twitter: p.social_links?.twitter || '',
          google_review: p.social_links?.google_review || '',
          youtube: p.social_links?.youtube || '',
          website_published: !!p.website_published,
        })
        setTheme(themeRes.data.data)
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  const updateField = (key: keyof typeof fields, value: string | boolean) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  const updateThemeField = (key: keyof Theme, value: string) => {
    setTheme((prev) => ({ ...prev, [key]: value }))
  }

  const saveProfile = async () => {
    const name = fields.name.trim()
    if (name.length < 2) {
      toast.error('Restaurant name must be at least 2 characters')
      return
    }
    setSavingProfile(true)
    try {
      await api.put('/restaurants/me', {
        name,
        logo_url: fields.logo_url || null,
        hero_image_url: fields.hero_image_url || null,
        tagline: fields.tagline || null,
        description: fields.description || null,
        address: fields.address || null,
        phone: fields.phone || null,
        whatsapp: fields.whatsapp || null,
        public_email: fields.public_email || null,
        social_links: {
          google_review: fields.google_review,
          facebook: fields.facebook,
          instagram: fields.instagram,
          twitter: fields.twitter,
          youtube: fields.youtube,
        },
        website_published: fields.website_published,
      })
      toast.success('Branding saved')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingProfile(false)
    }
  }

  const saveTheme = async () => {
    setSavingTheme(true)
    try {
      await api.put('/restaurants/me/theme', theme)
      toast.success('Theme saved')
    } catch (err) {
      toast.error(getErrorMessage(err))
    } finally {
      setSavingTheme(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loading size="lg" text="Loading branding settings..." />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Branding & Website</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Control how your restaurant looks on its public website
        </p>
      </div>

      {/* ── Logo & Images ──────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <PhotoIcon className="h-5 w-5 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Logo & Images</h2>
        </div>
        <div className="space-y-4">
          <ImageField
            label="Logo"
            value={fields.logo_url}
            onChange={(url) => updateField('logo_url', url)}
            shape="logo"
            maxSize={500}
            folder="logos"
            help="Shown as a round badge on your customer menu. A square logo works best."
          />
          <ImageField
            label="Cover photo"
            value={fields.hero_image_url}
            onChange={(url) => updateField('hero_image_url', url)}
            shape="wide"
            maxSize={1400}
            folder="covers"
            help="Wide photo of your restaurant or best dish. Shown at the top of your customer menu."
          />
        </div>
      </Card>

      {/* ── Business Info ──────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <GlobeAltIcon className="h-5 w-5 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Business Info</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Restaurant Name</label>
            <input
              type="text"
              value={fields.name}
              maxLength={255}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="e.g. Veg & Velvet"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">
              Shown on the customer menu and website. Your menu link and table QR codes keep working.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tagline</label>
            <input
              type="text"
              value={fields.tagline}
              onChange={(e) => updateField('tagline', e.target.value)}
              placeholder="e.g. Authentic flavors, made fresh daily"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={fields.description}
              onChange={(e) => updateField('description', e.target.value)}
              rows={3}
              placeholder="A short paragraph about your restaurant"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <input
              type="text"
              value={fields.address}
              onChange={(e) => updateField('address', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={fields.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp</label>
              <input
                type="text"
                value={fields.whatsapp}
                onChange={(e) => updateField('whatsapp', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Public Email</label>
            <input
              type="email"
              value={fields.public_email}
              onChange={(e) => updateField('public_email', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Google Review</label>
              <input
                type="text"
                value={fields.google_review}
                onChange={(e) => updateField('google_review', e.target.value)}
                placeholder="https://search.google.com/local/writereview?..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Facebook</label>
              <input
                type="text"
                value={fields.facebook}
                onChange={(e) => updateField('facebook', e.target.value)}
                placeholder="https://facebook.com/..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Instagram</label>
              <input
                type="text"
                value={fields.instagram}
                onChange={(e) => updateField('instagram', e.target.value)}
                placeholder="https://instagram.com/..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">YouTube</label>
              <input
                type="text"
                value={fields.youtube}
                onChange={(e) => updateField('youtube', e.target.value)}
                placeholder="https://youtube.com/@..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Twitter / X</label>
              <input
                type="text"
                value={fields.twitter}
                onChange={(e) => updateField('twitter', e.target.value)}
                placeholder="https://x.com/..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={fields.website_published}
              onChange={(e) => updateField('website_published', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">Publish public website</span>
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={saveProfile} isLoading={savingProfile}>
            Save Branding
          </Button>
        </div>
      </Card>

      {/* ── Theme Colors ───────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <SwatchIcon className="h-5 w-5 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Theme Colors</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {([
            ['primary_color', 'Primary'],
            ['secondary_color', 'Secondary'],
            ['accent_color', 'Accent'],
            ['background_color', 'Background'],
            ['text_color', 'Text'],
          ] as [keyof Theme, string][]).map(([key, label]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={theme[key]}
                  onChange={(e) => updateThemeField(key, e.target.value)}
                  className="h-9 w-9 rounded border border-slate-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={theme[key]}
                  onChange={(e) => updateThemeField(key, e.target.value)}
                  className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Font</label>
            <select
              value={theme.font_family}
              onChange={(e) => updateThemeField('font_family', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={saveTheme} isLoading={savingTheme}>
            Save Theme
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default Branding
