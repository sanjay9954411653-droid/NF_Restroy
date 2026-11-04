import toast from 'react-hot-toast'
import { ArrowDownTrayIcon, PrinterIcon } from '@heroicons/react/24/outline'
import { ReportTable, exportExcel, exportPdf } from '../lib/exportReport'

interface ExportButtonsProps {
  /** Heading on the PDF */
  title: string
  /** Line under the heading on the PDF, e.g. the period */
  subtitle: string
  /** File name without extension (today's date is added) */
  filename: string
  /** Called at click time, so the file always has what is on screen */
  getTables: () => ReportTable[]
  disabled?: boolean
}

/** "Excel" and "PDF" buttons for a report card. */
const ExportButtons: React.FC<ExportButtonsProps> = ({ title, subtitle, filename, getTables, disabled }) => {
  const stamp = () => new Date().toLocaleDateString('en-CA')

  const toExcel = () => {
    try {
      exportExcel(`${filename}_${stamp()}.xlsx`, getTables())
      toast.success('Excel file downloaded')
    } catch {
      toast.error('Could not create the Excel file')
    }
  }

  const toPdf = () => {
    try {
      if (!exportPdf(title, subtitle, getTables())) {
        toast.error('Pop-up blocked — allow pop-ups for this site and try again')
      }
    } catch {
      toast.error('Could not create the PDF')
    }
  }

  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 ' +
    'hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="flex gap-2">
      <button type="button" onClick={toExcel} disabled={disabled} className={base}>
        <ArrowDownTrayIcon className="w-4 h-4" />
        Excel
      </button>
      <button type="button" onClick={toPdf} disabled={disabled} className={base}>
        <PrinterIcon className="w-4 h-4" />
        PDF
      </button>
    </div>
  )
}

export default ExportButtons
