import React from 'react';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';

const emptyResource = { name: '', quantity: 0, price: 0, priceType: 'per_stay', propertyIds: [], description: '' };

export default function ResourcesPage() {
  return (
    <PricedItemsPage
      pageTitle="Ressources"
      itemLabel="ressource"
      emptyForm={emptyResource}
      loadItems={async () => {
        const [items, properties] = await Promise.all([api.getResources(), api.getProperties()]);
        return { items, properties };
      }}
      createItem={(data) => api.createResource(data)}
      updateItem={(id, data) => api.updateResource(id, data)}
      deleteItem={(id) => api.deleteResource(id)}
      fromItem={(item) => ({
        ...item,
        propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds : [],
        description: item.note || item.description || '',
      })}
      toPayload={(form) => ({
        name: form.name,
        quantity: Number(form.quantity) || 0,
        price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
        priceType: form.priceType || 'per_stay',
        propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
        note: form.description || '',
      })}
      formNameKey="name"
      formDescriptionKey="description"
      showQuantity={true}
      isDeleteDisabled={(item) => {
        const n = (item.name || '').toLowerCase();
        return n.includes('lit') && (n.includes('bébé') || n.includes('bebe'));
      }}
    />
  );
}
