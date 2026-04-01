import React from 'react';
import api from '../api';
import PricedItemsPage from '../components/PricedItemsPage';

const emptyOption = { title: '', description: '', priceType: 'per_stay', price: 0, propertyIds: [] };

export default function OptionsPage() {
  return (
    <PricedItemsPage
      pageTitle="Options de sejour"
      itemLabel="option"
      emptyForm={emptyOption}
      loadItems={async () => {
        const [items, properties] = await Promise.all([api.getOptions(), api.getProperties()]);
        return { items, properties };
      }}
      createItem={(data) => api.createOption(data)}
      updateItem={(id, data) => api.updateOption(id, data)}
      deleteItem={(id) => api.deleteOption(id)}
      fromItem={(item) => ({
        ...item,
        propertyIds: Array.isArray(item.propertyIds) ? item.propertyIds : [],
      })}
      toPayload={(form) => ({
        title: form.title,
        description: form.description || '',
        price: form.priceType === 'free' ? 0 : Number(form.price) || 0,
        priceType: form.priceType || 'per_stay',
        propertyIds: form.propertyIds && form.propertyIds.length > 0 ? form.propertyIds : [],
      })}
      formNameKey="title"
      formDescriptionKey="description"
      showQuantity={false}
    />
  );
}
