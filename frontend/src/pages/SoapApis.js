import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SoapApis = () => {
  const { t } = useTranslation('soap-apis');
  const [soapApis, setSoapApis] = useState([]);
  const [formData, setFormData] = useState({ name: '', uri: '' });
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadSoapApis();
  }, []);

  const loadSoapApis = async () => {
    try {
      const response = await axios.get(`${API}/soap-apis`);
      setSoapApis(response.data);
    } catch (error) {
      console.error('Error loading SOAP APIs:', error);
      toast.error(t('toast.loadError'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(`${API}/soap-apis`, formData);
      toast.success(t('toast.created'));
      setFormData({ name: '', uri: '' });
      loadSoapApis();
    } catch (error) {
      console.error('Error creating SOAP API:', error);
      toast.error(t('toast.createError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/soap-apis/${id}`);
      toast.success(t('toast.deleted'));
      loadSoapApis();
    } catch (error) {
      console.error('Error deleting SOAP API:', error);
      toast.error(t('toast.deleteError'));
    }
  };

  return (
    <div className="space-y-6" data-testid="soap-apis-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('header.title')}</h1>
          <p className="text-muted-foreground mt-2">{t('header.subtitle')}</p>
        </div>
        <Button 
          onClick={() => setShowAddForm(!showAddForm)} 
          data-testid="toggle-add-form-btn"
          variant={showAddForm ? "secondary" : "default"}
        >
          {showAddForm ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              {t('common:actions.close')}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              {t('header.add')}
            </>
          )}
        </Button>
      </div>

      {/* Form Card - Collapsible */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('form.title')}</CardTitle>
            <CardDescription>{t('form.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('form.nameLabel')}</Label>
                  <Input
                    id="name"
                    data-testid="soap-api-name-input"
                    placeholder={t('form.namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uri">{t('form.uriLabel')}</Label>
                  <Input
                    id="uri"
                    data-testid="soap-api-uri-input"
                    type="url"
                    placeholder={t('form.uriPlaceholder')}
                    value={formData.uri}
                    onChange={(e) => setFormData({ ...formData, uri: e.target.value })}
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={loading} data-testid="add-soap-api-btn">
                <Plus className="w-4 h-4 mr-2" />
                {t('header.add')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          <CardDescription>{t('list.count', { count: soapApis.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {soapApis.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('list.empty')}</p>
          ) : (
            <div className="space-y-3">
              {soapApis.map((api) => (
                <div
                  key={api.id}
                  data-testid={`soap-api-item-${api.id}`}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">{t('list.nameLabel')}</div>
                      <div className="font-medium">{api.name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">{t('list.uriLabel')}</div>
                      <div className="font-mono text-sm break-all">{api.uri}</div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(api.id)}
                    data-testid={`delete-soap-api-${api.id}`}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-4"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SoapApis;