export type AssetStatus = "tersedia" | "dipinjam" | "rusak" | "pending";
export type TransactionAction = "BORROW" | "RETURN";
export type TransactionStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "ACTIVE" | "COMPLETED";

export interface Profile {
  id: string;
  full_name: string;
  email?: string | null;
  nrp: string | null;
  phone: string | null;
  avatar_url?: string | null;
  role: "petugas" | "admin";
  status?: "PENDING" | "ACTIVE" | "INACTIVE" | string | null;
  created_at: string;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  serial_number: string;
  status: AssetStatus;
  qr_code_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  asset_id: string;
  user_id: string | null;
  borrower_id?: string | null;
  borrower_name: string | null;
  borrower_nrp: string | null;
  kesatuan: string | null;
  action: TransactionAction;
  status: TransactionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  condition: string | null;
  notes: string | null;
  batch_id?: string | null;
  batch_code?: string | null;
  due_date?: string | null;
  document_url?: string | null;
  document_name?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_at: string;
  updated_at?: string;
  // Relationship joins
  asset?: Asset;
  reviewer?: Profile;
}

export interface LoanDurationPreset {
  id: string;
  label: string;
  duration_hours: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at?: string;
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      assets: {
        Row: Asset;
        Insert: Partial<Asset>;
        Update: Partial<Asset>;
        Relationships: [];
      };
      transactions: {
        Row: Transaction;
        Insert: Partial<Transaction>;
        Update: Partial<Transaction>;
        Relationships: [];
      };
      loan_duration_presets: {
        Row: LoanDurationPreset;
        Insert: Partial<LoanDurationPreset>;
        Update: Partial<LoanDurationPreset>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      process_asset_transaction: {
        Args: {
          p_asset_id: string;
          p_action: string;
          p_borrower_name?: string | null;
          p_borrower_nrp?: string | null;
          p_kesatuan?: string | null;
          p_condition?: string | null;
          p_notes?: string | null;
          p_due_date?: string | null;
          p_document_url?: string | null;
          p_document_name?: string | null;
        };
        Returns: string;
      };
      process_batch_asset_transaction: {
        Args: {
          p_asset_ids: string[];
          p_action?: string | null;
          p_borrower_name?: string | null;
          p_borrower_nrp?: string | null;
          p_kesatuan?: string | null;
          p_condition?: string | null;
          p_notes?: string | null;
          p_due_date?: string | null;
          p_document_url?: string | null;
          p_document_name?: string | null;
        };
        Returns: any;
      };
      approve_borrow_request: {
        Args: {
          p_tx_id: string;
          p_admin_id?: string | null;
        };
        Returns: any;
      };
      scan_to_borrow: {
        Args: {
          p_scanned_qr: string;
          p_tx_id?: string | null;
          p_user_id?: string | null;
        };
        Returns: any;
      };
      confirm_physical_handover: {
        Args: {
          p_asset_id: string;
        };
        Returns: any;
      };
      approve_transaction: {
        Args: {
          p_transaction_id: string;
        };
        Returns: void;
      };
      approve_batch_transaction: {
        Args: {
          p_batch_id: string;
        };
        Returns: any;
      };
      reject_transaction: {
        Args: {
          p_transaction_id: string;
          p_reason?: string | null;
        };
        Returns: void;
      };
      reject_batch_transaction: {
        Args: {
          p_batch_id: string;
          p_reason?: string | null;
        };
        Returns: any;
      };
      admin_override_asset_status: {
        Args: {
          p_asset_id: string;
          p_new_status: AssetStatus;
          p_reason?: string | null;
        };
        Returns: void;
      };
      admin_upsert_asset: {
        Args: {
          p_id?: string | null;
          p_code?: string | null;
          p_name?: string | null;
          p_serial_number?: string | null;
        };
        Returns: string;
      };
      admin_update_user_role: {
        Args: {
          p_target_user_id: string;
          p_new_role: string;
        };
        Returns: void;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
