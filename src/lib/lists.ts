'use client';
import { rpc, type CustomerRow, type Product } from './api';
import { useQuery, type Query } from './data';
import { useShop } from './session';

/** Full customer / product lists, cached on the device so search works instantly and offline. */
export function useCustomers(): Query<CustomerRow[]> {
  const { shop, scope } = useShop();
  return useQuery(() => rpc<CustomerRow[]>('list_customers', { p_shop_id: shop.id }), [shop.id], `${scope}customers`);
}
export function useProducts(): Query<Product[]> {
  const { shop, scope } = useShop();
  return useQuery(() => rpc<Product[]>('list_products', { p_shop_id: shop.id }), [shop.id], `${scope}products`);
}
