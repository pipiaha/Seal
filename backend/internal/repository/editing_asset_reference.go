package repository

import (
	"errors"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) HasEditingMediaReference(userID, canvasID, editID, assetID, resourceID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.EditingAssetReference{}).Where("user_id = ? AND canvas_id = ? AND edit_id = ? AND asset_id = ? AND resource_id = ?", userID, canvasID, editID, assetID, resourceID).Count(&count).Error
	return count > 0, err
}

func (r *Repository) PinEditingAsset(reference model.EditingAssetReference) (bool, error) {
	created := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&reference)
	if created.Error != nil {
		return false, created.Error
	}
	var existing model.EditingAssetReference
	if err := r.db.First(&existing, "id = ?", reference.ID).Error; err != nil {
		return false, err
	}
	if existing.UserID != reference.UserID || existing.CanvasID != reference.CanvasID || existing.EditID != reference.EditID || existing.AssetID != reference.AssetID || existing.ResourceID != reference.ResourceID {
		return false, errors.New("editing operation belongs to another asset")
	}
	return created.RowsAffected == 1, nil
}

func (r *Repository) UnpinEditingAsset(userID, id string) error {
	return r.db.Where("user_id = ? AND id = ?", userID, id).Delete(&model.EditingAssetReference{}).Error
}

func (r *Repository) EditingAssetReferences(userID string) ([]model.EditingAssetReference, error) {
	if !r.db.Migrator().HasTable(&model.EditingAssetReference{}) {
		return nil, nil
	}
	var references []model.EditingAssetReference
	err := r.db.Where("user_id = ?", userID).Find(&references).Error
	return references, err
}

func (r *Repository) editingAssetReferences(userID, assetID string, resourceIDs []string) ([]ResourceDirectReference, error) {
	if !r.db.Migrator().HasTable(&model.EditingAssetReference{}) {
		return nil, nil
	}
	query := r.db.Where("user_id = ?", userID)
	if assetID != "" {
		query = query.Where("asset_id = ?", assetID)
	} else {
		query = query.Where("resource_id IN ?", resourceIDs)
	}
	var references []model.EditingAssetReference
	if err := query.Find(&references).Error; err != nil {
		return nil, err
	}
	result := make([]ResourceDirectReference, 0, len(references))
	for _, reference := range references {
		result = append(result, ResourceDirectReference{Kind: "剪辑工程（含撤销记录）", ID: reference.EditID, Title: "剪辑工程", ResourceID: reference.ResourceID})
	}
	return result, nil
}
