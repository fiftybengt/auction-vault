import { useParams } from 'react-router'
import { Money } from '../components/Money'
import { ItemLink } from '../components/Quality'
import { Card, Gate } from '../components/States'
import { useSeller } from '../lib/data'
import { formatInt } from '../lib/format'

export default function Seller() {
  const { market = '', name = '' } = useParams()
  const seller = useSeller(market, name)
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{name}</h1>
      <Gate r={seller} what={`listings for ${name}`}>
        {(s) => (
          <Card title="Currently listed" subtitle={`${formatInt(s.listings)} listings across ${formatInt(s.items.length)} items, latest complete scan`}>
            <table className="w-full text-left text-sm tabular">
              <thead className="text-xs text-ink-2">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Item</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Listings</th>
                  <th className="py-1.5 text-right font-medium">Unit</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((it) => (
                  <tr key={it.key} className="border-t border-hairline">
                    <td className="py-1.5 pr-2">
                      <ItemLink market={market} itemKey={it.key} name={it.name} quality={it.quality} />
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatInt(it.count)}</td>
                    <td className="py-1.5 text-right">
                      <Money c={it.unit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Gate>
    </div>
  )
}
